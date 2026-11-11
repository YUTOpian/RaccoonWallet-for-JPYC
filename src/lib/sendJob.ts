import i18n from '../i18n';
import { sendJpyc, sendNative, sendErc20, parseSendError, extractRpcMessage } from './chains';
import type { ChainKey } from './chains';
import { sendCustomChainNative, sendCustomChainToken } from './customChains';
import { isExternalWalletError } from './externalWallet';
import { isGaslessError, signTransferAuthorization, submitToRelayer, waitForRelayedTx } from './gasless';
import type { SignerSource } from './signer';
import { RecipientSafetyHelper, TxAnnotationsHelper } from './storage';
import type { CustomChainRecord, TxAnnotationTag } from './storage';
import { notify } from '../store/notificationStore';
import { useAppStore } from '../store/appStore';
import { playSentSound, playCompletedSound } from './sounds';

export interface SendJobParams {
  signer: SignerSource;
  to: string;
  amount: string;
  /** 通知に出す通貨名(POL / JPYC など) */
  symbol: string;
  activeChain: ChainKey;
  sendCurrency: string;
  sendTokenMeta: { address: string; symbol: string; decimals: number } | null;
  customChain: CustomChainRecord | null;
  /** ブロックエクスプローラのURL(取引リンク用)。無ければ null */
  explorerBase: string | null;
  /** JPYC送金をガスレス(EIP-3009 + リレイヤー)で行う。ガス代用のネイティブ通貨が不要。 */
  gasless?: { relayerUrl: string };
  /** 送金時に付けた会計用のタグ・メモ。送信できた時点で、その取引に紐づけて保存する(ERC-20の送金のみ)。 */
  annotation?: { tag: TxAnnotationTag; memo: string; category?: string };
  /** ネットワークへ送信できた時に呼ばれる(予約送金が「支払い済み」を記録するのに使う)。 */
  onBroadcast?: (txHash: string) => void;
  /** 送信できないまま失敗した時に呼ばれる(ブロードキャスト後の失敗では呼ばれない)。 */
  onFailed?: () => void;
}

/** 送金失敗を、通知に出す1本の文章にする。 */
function describeError(error: unknown, p: SendJobParams): string {
  const t = i18n.t.bind(i18n);
  if (isExternalWalletError(error)) {
    return t(`external.error_${error.code}`);
  }
  if ((error as { code?: string } | null)?.code === 'ACTION_REJECTED') {
    return t('external.error_rejected');
  }
  if (isGaslessError(error)) {
    return t(`gas.error_${error.code}`, { detail: error.detail });
  }
  if (p.customChain) {
    return `${t('send.error_unknown_title')}: ${extractRpcMessage(error)}`;
  }
  const parsed = parseSendError(error, {
    chain: p.activeChain,
    isNativeSend: p.sendCurrency === 'native',
    amount: p.amount,
  });
  const hasFigures = parsed.estimatedFee != null || parsed.balance != null;
  const messageKey =
    (parsed.kind === 'insufficient_gas' || parsed.kind === 'insufficient_total') && !hasFigures
      ? `send.error_${parsed.kind}_message_simple`
      : `send.error_${parsed.kind}_message`;
  const lines = t(messageKey, {
    returnObjects: true,
    symbol: parsed.symbol,
    amount: parsed.amount,
    fee: parsed.estimatedFee,
    total: parsed.requiredTotal,
    balance: parsed.balance,
    detail: parsed.rawMessage,
  }) as string[] | string;
  const body = Array.isArray(lines) ? lines.join(' ') : lines;
  return `${t(`send.error_${parsed.kind}_title`)} ${body}`;
}

/**
 * 送金を画面から切り離して裏で実行する。呼び出し側はすぐホームへ戻れる。
 *  - ネットワークへ送信できた時点: 「送金しました」+ ding
 *  - ブロックに取り込まれた時点:  「送金完了」+ ding2
 *  - どこかで失敗した時:           エラー通知(音なし)
 * 完了までは数秒~数十秒かかるが、その間ユーザーは自由にアプリを操作できる。
 */
export function startSend(p: SendJobParams): void {
  const t = i18n.t.bind(i18n);

  let broadcast = false;
  const onBroadcast = (txHash: string) => {
    broadcast = true;
    // 「送ったことのある相手」として覚える(アドレス詐欺対策: 次回から初めての相手扱いにしない)。
    void RecipientSafetyHelper.recordSent(p.to, p.customChain ? `custom:${p.customChain.id}` : p.activeChain).catch((e) => console.warn('recordSent failed', e));
    // 履歴(TransactionWrapper.annotationKey)と同じキーで、タグ・メモを保存する。履歴に出るのは
    // ERC-20の転送だけなので、ネイティブ通貨の送金には付けない。
    if (p.annotation && (p.annotation.tag !== '' || p.annotation.memo !== '' || !!p.annotation.category) && p.sendCurrency !== 'native') {
      const key = TxAnnotationsHelper.makeKey(p.customChain ? p.customChain.id : p.activeChain, txHash, p.symbol, false);
      void TxAnnotationsHelper.set(key, p.annotation).catch((e) => console.warn('save annotation failed', e));
    }
    try {
      p.onBroadcast?.(txHash);
    } catch (e) {
      console.error('sendJob onBroadcast hook failed', e);
    }
    useAppStore.getState().setLastTxHash(txHash);
    notify({
      severity: 'info',
      message: t('send.notice_sent', { amount: p.amount, symbol: p.symbol }),
      explorerUrl: p.explorerBase ? `${p.explorerBase}/tx/${txHash}` : null,
    });
    playSentSound();
  };

  void (async () => {
    try {
      let receipt;
      if (p.customChain) {
        receipt = p.sendTokenMeta != null
          ? await sendCustomChainToken(
              p.customChain.rpcUrl, p.customChain.chainId, p.signer,
              { address: p.sendTokenMeta.address, symbol: p.sendTokenMeta.symbol, name: p.sendTokenMeta.symbol, decimals: p.sendTokenMeta.decimals },
              p.to, p.amount, onBroadcast,
            )
          : await sendCustomChainNative(p.customChain.rpcUrl, p.customChain.chainId, p.signer, p.to, p.amount, onBroadcast);
      } else if (p.sendCurrency === 'jpyc' && p.gasless) {
        // 署名だけして、取引の送信とガス代はリレイヤーに任せる。
        const authorization = await signTransferAuthorization(p.activeChain, p.signer, p.to, p.amount);
        const relayedHash = await submitToRelayer(p.gasless.relayerUrl, authorization);
        onBroadcast(relayedHash);
        receipt = await waitForRelayedTx(p.activeChain, relayedHash);
      } else if (p.sendCurrency === 'jpyc') {
        receipt = await sendJpyc(p.activeChain, p.signer, p.to, p.amount, onBroadcast);
      } else if (p.sendCurrency === 'native') {
        receipt = await sendNative(p.activeChain, p.signer, p.to, p.amount, onBroadcast);
      } else if (p.sendTokenMeta != null) {
        receipt = await sendErc20(p.activeChain, p.signer, p.sendTokenMeta.address, p.sendTokenMeta.decimals, p.to, p.amount, onBroadcast);
      } else {
        throw new Error('Unknown send currency');
      }

      const txHash = receipt?.hash ?? '';
      notify({
        severity: 'success',
        message: t('send.notice_completed', { amount: p.amount, symbol: p.symbol }),
        explorerUrl: txHash && p.explorerBase ? `${p.explorerBase}/tx/${txHash}` : null,
      });
      playCompletedSound();
    } catch (error) {
      if (!broadcast) p.onFailed?.();
      notify({ severity: 'error', message: describeError(error, p) });
    }
  })();
}

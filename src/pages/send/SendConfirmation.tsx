import { useEffect, useState } from 'react';
import { Autocomplete, Box, Typography, Paper, Divider, Button, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppToolBar from '../../components/AppToolBar';
import MessageDialog from '../../components/MessageDialog';
import PasswordDialog from '../../components/PasswordDialog';
import ErrorSnackbar from '../../components/ErrorSnackbar';
import GasFeeBlock from '../../components/GasFeeBlock';
import AddressSafetyBlock, { AddressBadges, AddressChunks } from '../../components/AddressSafetyBlock';
import { useAddressSafety } from '../../hooks/useAddressSafety';
import { useGaslessOption } from '../../hooks/useGaslessOption';
import { WalletsHelper, CustomChainsHelper, TxAnnotationsHelper } from '../../lib/storage';
import type { CustomChainRecord, TxAnnotationRecord, TxAnnotationTag } from '../../lib/storage';
import { categorySuggestions, supportsCategory } from '../../lib/txCategories';
import { CHAINS, estimateSendFee, extractRpcMessage } from '../../lib/chains';
import type { ChainKey } from '../../lib/chains';
import { estimateCustomChainSendFee } from '../../lib/customChains';
import { startSend } from '../../lib/sendJob';
import { unlockSounds } from '../../lib/sounds';
import { useAppStore } from '../../store/appStore';
import { ethers } from 'ethers';
import { chainTargetFromKey, getExternalSigner, isExternalWalletError } from '../../lib/externalWallet';
import type { SignerSource } from '../../lib/signer';
import heroSendSmall from '../../assets/heroimage_send_small.png';
import iconPinSmall from '../../assets/icon_pin_small.png';

export default function SendConfirmation() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const backPath = useAppStore((s) => s.backPathFromSendConfirmation);
  const calculatorFormula = useAppStore((s) => s.calculatorFormula);
  const receiverAddress = useAppStore((s) => s.receiverAddress);
  const activeChain = useAppStore((s) => s.activeChain) as ChainKey;
  const sendCurrency = useAppStore((s) => s.sendCurrency);
  const sendTokenMeta = useAppStore((s) => s.sendTokenMeta);
  const sendCustomChainId = useAppStore((s) => s.sendCustomChainId);

  // A network added by hand under 設定 > カスタムEVM (see CustomChainRecord in
  // lib/storage.ts) isn't in the curated CHAINS registry, so this screen looks its config
  // up separately whenever sendCustomChainId is set (see SendAmount.tsx) rather than
  // indexing CHAINS[activeChain], which would throw for it.
  const isCustomChain = sendCustomChainId !== null;
  const [customChain, setCustomChain] = useState<CustomChainRecord | null>(null);

  useEffect(() => {
    if (sendCustomChainId === null) {
      setCustomChain(null);
      return;
    }
    (async () => {
      setCustomChain(await CustomChainsHelper.get(sendCustomChainId));
    })();
  }, [sendCustomChainId]);

  const activeChainConfig = isCustomChain ? null : CHAINS[activeChain];
  const networkName = isCustomChain ? (customChain?.name ?? '') : (activeChainConfig?.name ?? '');
  const nativeSymbol = isCustomChain ? (customChain?.currencySymbol ?? '') : (activeChainConfig?.nativeCurrency.symbol ?? '');
  const isToken = sendCurrency !== 'jpyc' && sendCurrency !== 'native';
  const currencyLabel = isToken ? (sendTokenMeta?.symbol ?? '') : sendCurrency === 'jpyc' ? 'JPYC' : nativeSymbol;

  // 会計用のタグ・メモ(任意)。送金できた時点で、その取引に紐づけて保存される(lib/sendJob.ts)。
  const [annotationTag, setAnnotationTag] = useState<TxAnnotationTag>('');
  const [annotationMemo, setAnnotationMemo] = useState('');
  const [annotationCategory, setAnnotationCategory] = useState('');
  const [pastAnnotations, setPastAnnotations] = useState<Record<string, TxAnnotationRecord>>({});
  useEffect(() => {
    void TxAnnotationsHelper.getAll().then(setPastAnnotations);
  }, []);

  const [showSendCaution, setShowSendCaution] = useState(true);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // 'loading' while the estimate request is in flight, null once it settles with no result
  // (bad address, RPC failure) so the UI can fall back to "not available" instead of "0".
  const [estimatedFee, setEstimatedFee] = useState<string | null | 'loading'>('loading');
  // ガス不足の判定(GasFeeBlock)と、ガスレス送金(リレイヤー経由)の選択状態。
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [gasBlocked, setGasBlocked] = useState(false);
  const [useGasless, setUseGasless] = useState(false);
  const gaslessOption = useGaslessOption(isCustomChain || sendCurrency !== 'jpyc' ? null : activeChain);
  const gaslessOn = useGasless && gaslessOption.available;

  // アドレス詐欺対策: 宛先の判定(アドレス帳・送ったことがあるか・似たアドレス・ネットワーク)。
  // 警告が出た時は、確認のチェックを入れるまで送れない。
  const setReceiverAddress = useAppStore((s) => s.setReceiverAddress);
  const safetyChain = isCustomChain ? `custom:${sendCustomChainId}` : activeChain;
  const safety = useAddressSafety(receiverAddress, safetyChain);
  const [safetyAck, setSafetyAck] = useState(false);
  useEffect(() => setSafetyAck(false), [receiverAddress, safetyChain]);
  const safetyBlocked = safety === null || (safety.requiresAck && !safetyAck);

  useEffect(() => {
    void (async () => setWalletAddress((await WalletsHelper.getActive())?.address ?? null))();
  }, []);

  useEffect(() => {
    // A custom chain's fee is estimated once its rpcUrl is known (see the customChain load
    // above) - skip the curated-chain estimate below while that's still resolving, rather
    // than briefly showing a curated-chain estimate that doesn't apply.
    if (isCustomChain && customChain === null) {
      setEstimatedFee('loading');
      return;
    }
    let cancelled = false;
    setEstimatedFee('loading');
    (async () => {
      const activeWallet = await WalletsHelper.getActive();
      if (!activeWallet || cancelled) return;
      const fee = isCustomChain && customChain
        ? await estimateCustomChainSendFee(
            customChain.rpcUrl,
            activeWallet.address,
            receiverAddress,
            calculatorFormula,
            sendTokenMeta
              ? { address: sendTokenMeta.address, symbol: sendTokenMeta.symbol, name: sendTokenMeta.symbol, decimals: sendTokenMeta.decimals }
              : undefined,
          )
        : await estimateSendFee(
            activeChain,
            activeWallet.address,
            receiverAddress,
            sendCurrency === 'native' ? 'native' : sendCurrency === 'jpyc' ? 'jpyc' : 'token',
            calculatorFormula,
            sendTokenMeta ? { address: sendTokenMeta.address, decimals: sendTokenMeta.decimals } : undefined,
          );
      if (!cancelled) {
        setEstimatedFee(fee);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChain, receiverAddress, sendCurrency, calculatorFormula, sendTokenMeta, isCustomChain, customChain]);

  // pin === null: MetaMask / Bitget Wallet で接続中のウォレット。PIN は使わず、署名は拡張側で承認する。
  // 署名の準備(PIN確認・拡張側の承認)ができたら、送金そのものは裏で進めてすぐホームへ戻る
  // (lib/sendJob.ts)。送信できた時と完了した時は、右上の通知と音でお知らせする。
  const onPassed = async (pin: string | null) => {
    const amount = calculatorFormula;
    const to = receiverAddress;

    if (!ethers.isAddress(to)) {
      setErrorMessage(t('common.invalid_address'));
      return;
    }

    setSending(true);
    try {
      const activeWallet = await WalletsHelper.getActive();
      if (!activeWallet) {
        return;
      }
      let privateKey: SignerSource;
      if (activeWallet.externalProvider) {
        const target = isCustomChain && customChain
          ? {
              chainId: customChain.chainId,
              name: customChain.name,
              rpcUrl: customChain.rpcUrl,
              symbol: customChain.currencySymbol,
              decimals: 18,
              blockExplorerUrl: customChain.blockExplorerUrl || undefined,
            }
          : chainTargetFromKey(activeChain);
        privateKey = await getExternalSigner(activeWallet.externalProvider, activeWallet.address, target);
      } else {
        const decrypted = pin == null ? null : await WalletsHelper.decryptKey(activeWallet.id, pin);
        if (decrypted == null) {
          setErrorMessage(t('wallet.invalid_key'));
          return;
        }
        privateKey = decrypted;
      }

      startSend({
        signer: privateKey,
        to,
        amount,
        symbol: currencyLabel,
        activeChain,
        sendCurrency,
        sendTokenMeta,
        customChain: isCustomChain ? customChain : null,
        annotation: { tag: annotationTag, memo: annotationMemo.trim(), category: supportsCategory(annotationTag) ? annotationCategory.trim() : '' },
        explorerBase: (isCustomChain ? customChain?.blockExplorerUrl : activeChainConfig?.blockExplorerUrl) || null,
        gasless: gaslessOn ? { relayerUrl: gaslessOption.relayerUrl } : undefined,
      });
      navigate('/top?tab=home', { replace: true });
    } catch (error) {
      if (isExternalWalletError(error)) {
        setErrorMessage(t(`external.error_${error.code}`));
        return;
      }
      if ((error as { code?: string } | null)?.code === 'ACTION_REJECTED') {
        setErrorMessage(t('external.error_rejected'));
        return;
      }
      setErrorMessage(extractRpcMessage(error));
    } finally {
      setSending(false);
    }
  };

  const onPressConfirm = async () => {
    if (safetyBlocked) return;
    unlockSounds(); // 完了音を後から鳴らせるよう、タップのタイミングで音の再生許可を取る
    if ((await WalletsHelper.getActive())?.externalProvider) {
      await onPassed(null);
    } else {
      setShowPasswordDialog(true);
    }
  };

  // 画面幅が広くても内容が左端に張り付かないよう、全体を中央寄せの固定幅カラムにする。
  const column = { width: '100%', maxWidth: 560, mx: 'auto', px: 2, boxSizing: 'border-box' } as const;

  const labelSx = { color: 'text.secondary', fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.04em' } as const;

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: '#f7f9f9' }}>
      <AppToolBar back={backPath} title={t('send.confirmation_title')} />

      <Box sx={{ flex: 1, ...column, pt: 2, pb: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box
          component="img"
          src={heroSendSmall}
          sx={{ width: '100%', height: { xs: 120, sm: 160 }, objectFit: 'cover', borderRadius: 4, display: 'block' }}
        />

        {/* 金額（主役） */}
        <Paper sx={{ p: 3, textAlign: 'center', borderRadius: 4 }}>
          <Typography sx={labelSx}>{t('common.amount')}</Typography>
          <Typography
            sx={{ mt: 0.5, fontSize: { xs: '2rem', sm: '2.4rem' }, fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}
          >
            {calculatorFormula}
            <Typography component="span" sx={{ ml: 1, fontSize: '1.1rem', fontWeight: 600, color: 'primary.main' }}>
              {currencyLabel}
            </Typography>
          </Typography>
        </Paper>

        {/* 詳細 */}
        <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
          <Box sx={{ px: 3, py: 2 }}>
            <Typography sx={labelSx}>{t('send.network')}</Typography>
            <Typography sx={{ mt: 0.5, fontWeight: 600 }}>{networkName}</Typography>
          </Box>
          <Divider />
          <Box sx={{ px: 3, py: 2 }}>
            <Typography sx={labelSx}>{t('common.destination')}</Typography>
            <Box sx={{ mt: 0.5 }}>
              <AddressChunks address={receiverAddress} />
            </Box>
            <AddressBadges assessment={safety} />
          </Box>
          <Divider />
          <GasFeeBlock
            chain={isCustomChain ? null : activeChain}
            address={walletAddress}
            fee={estimatedFee}
            nativeSymbol={nativeSymbol}
            nativeSendAmount={sendCurrency === 'native' ? calculatorFormula : undefined}
            gaslessAvailable={gaslessOption.available}
            gasless={gaslessOn}
            onGaslessChange={setUseGasless}
            onBlockedChange={setGasBlocked}
            label={t('send.gas_fee')}
          />
        </Paper>

        {/* 会計用のタグ・メモ。履歴に出るのはERC-20の転送だけなので、ネイティブ通貨の送金では出さない。 */}
        {sendCurrency !== 'native' && (
          <Paper sx={{ p: 3, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography sx={labelSx}>{t('send.annotation_title')}</Typography>
            <ToggleButtonGroup
              exclusive size="small" color="primary" value={annotationTag}
              onChange={(_, next: TxAnnotationTag | null) => {
                setAnnotationTag(next ?? '');
                setAnnotationCategory(''); // 分類を変えたら、前の分類の費目は引き継がない
              }}
            >
              <ToggleButton value="sales">{t('transaction.tag_sales')}</ToggleButton>
              <ToggleButton value="expense">{t('transaction.tag_expense')}</ToggleButton>
              <ToggleButton value="personal">{t('transaction.tag_personal')}</ToggleButton>
            </ToggleButtonGroup>
            {supportsCategory(annotationTag) && (
              <Autocomplete
                freeSolo size="small" options={categorySuggestions(annotationTag, pastAnnotations)}
                inputValue={annotationCategory}
                onInputChange={(_, value) => setAnnotationCategory(value)}
                renderInput={(params) => <TextField {...params} label={t('transaction.category_label')} />}
              />
            )}
            <TextField
              size="small" label={t('transaction.memo_label')} value={annotationMemo} multiline minRows={2}
              onChange={(e) => setAnnotationMemo(e.target.value)}
            />
          </Paper>
        )}

        <AddressSafetyBlock
          assessment={safety}
          to={receiverAddress}
          networkName={networkName}
          tokenLabel={currencyLabel}
          tokenAddress={isToken ? (sendTokenMeta?.address ?? null) : null}
          onUseKnownAddress={(address) => setReceiverAddress(address)}
          ack={safetyAck}
          onAckChange={setSafetyAck}
        />
      </Box>

      <MessageDialog
        open={showSendCaution}
        title={t('send.confirmation_title')}
        texts={t('send.confirmation_dialog_message', { returnObjects: true }) as string[]}
        onClose={() => setShowSendCaution(false)}
      />

      {/* 下部の確認バー：幅いっぱいのボタンで押しやすく */}
      <Box
        sx={{
          position: 'sticky',
          bottom: 0,
          bgcolor: '#fff',
          borderTop: '1px solid rgba(0,0,0,0.08)',
          pt: 1.5,
          pb: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <Box sx={column}>
          <Typography sx={{ textAlign: 'center', color: 'text.secondary', fontSize: '0.85rem', mb: 1 }}>
            {sending ? t('send.sending') : safetyBlocked ? t('safety.blocked_hint') : gasBlocked ? t('gas.blocked_hint', { symbol: nativeSymbol }) : t('send.confirmation_ready')}
          </Typography>
          <Button
            fullWidth
            variant="contained"
            size="large"
            disabled={sending || gasBlocked || safetyBlocked || (isCustomChain && customChain === null)}
            onClick={onPressConfirm}
            startIcon={
              <Box
                sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Box component="img" src={iconPinSmall} sx={{ width: 20, height: 20 }} />
              </Box>
            }
            sx={{ borderRadius: 999, py: 1.4, fontWeight: 700, fontSize: '1rem', textTransform: 'none', boxShadow: '0 4px 14px rgba(0,195,178,0.35)' }}
          >
            {t('send.confirmation_pin')}
          </Button>
        </Box>
      </Box>

      <PasswordDialog open={showPasswordDialog} mode="check" onClose={() => setShowPasswordDialog(false)} onPass={onPassed} />
      <ErrorSnackbar message={errorMessage} onClose={() => setErrorMessage('')} />
    </Box>
  );
}

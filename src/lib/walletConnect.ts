import { Core } from '@walletconnect/core';
import { WalletKit } from '@reown/walletkit';
import type { IWalletKit, WalletKitTypes } from '@reown/walletkit';
import { buildApprovedNamespaces, getSdkError } from '@walletconnect/utils';
import { CHAINS } from './chains';
import type { ChainKey } from './chains';
import { useDappStore } from '../store/dappStore';
import type { DappProposalView, DappRequestView, DappValidation } from '../store/dappStore';

/**
 * dApp(OpenSea などの NFT マーケットプレイス等)と WalletConnect v2 で接続するための薄いラッパー。
 *
 * - dApp の「WalletConnect」で表示される QR(wc:...)をこのアプリで読み取る/貼り付けると接続できる。
 * - 対応メソッドは personal_sign / eth_sendTransaction / wallet_switchEthereumChain だけ。
 *   それ以外(eth_signTypedData_v4 など)を「必須」にしている dApp は、接続時に理由を出して断る。
 * - 対応チェーンはアプリの curated 4チェーン(Ethereum / Polygon / Avalanche / Kaia。デバッグ
 *   モード中はそれぞれのテストネット)。カスタムEVMには対応しない。
 * - 署名の承認(PIN入力)と送信は画面側(pages/dapp/DappConnect.tsx)で行う。
 */

// Reown Cloud (https://cloud.reown.com) で発行する projectId。秘密情報ではない(ブラウザに
// 載る公開ID)ので、ビルド時の環境変数 VITE_WALLETCONNECT_PROJECT_ID で渡す。
// Reown Cloud 側の「Allowed Domains」に、このアプリを公開しているドメインを登録しておくこと。
export const WC_PROJECT_ID: string = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() ?? '';

export function isWalletConnectConfigured(): boolean {
  return WC_PROJECT_ID.length > 0;
}

/** file:// 直開きではオリジンが "null" になり WalletConnect の許可ドメイン検証が通らない。 */
export function isWalletConnectOriginUsable(): boolean {
  return window.location.protocol === 'https:' || window.location.protocol === 'http:';
}

export const SUPPORTED_METHODS = ['personal_sign', 'eth_sendTransaction', 'wallet_switchEthereumChain'] as const;
export const SUPPORTED_EVENTS = ['chainChanged', 'accountsChanged'] as const;

type Sessions = ReturnType<IWalletKit['getActiveSessions']>;
export type DappSession = Sessions[string];

export interface SupportedChain {
  key: ChainKey;
  chainId: number;
  caip: string;
}

/** 今のネットワークモード(本番/デバッグ)で対応しているチェーン。 */
export function supportedChains(): SupportedChain[] {
  return (Object.keys(CHAINS) as ChainKey[]).map((key) => ({
    key,
    chainId: CHAINS[key].chainId,
    caip: `eip155:${CHAINS[key].chainId}`,
  }));
}

/** 'eip155:137' → 対応チェーン。対応外なら null。 */
export function chainFromCaip(caip: string): SupportedChain | null {
  return supportedChains().find((c) => c.caip === caip) ?? null;
}

interface VerifyLike {
  verified?: { origin?: string; validation?: string; isScam?: boolean };
}

function readVerify(ctx: VerifyLike | undefined): { validation: DappValidation; isScam: boolean; origin: string } {
  const v = ctx?.verified;
  const validation: DappValidation = v?.validation === 'VALID' || v?.validation === 'INVALID' ? v.validation : 'UNKNOWN';
  return { validation, isScam: !!v?.isScam, origin: v?.origin ?? '' };
}

let kitPromise: Promise<IWalletKit> | null = null;

function toRequestView(kit: IWalletKit, e: WalletKitTypes.SessionRequest): DappRequestView {
  const meta = kit.getActiveSessions()[e.topic]?.peer?.metadata;
  const verify = readVerify((e as unknown as { verifyContext?: VerifyLike }).verifyContext);
  return {
    id: e.id,
    topic: e.topic,
    method: e.params.request.method,
    params: e.params.request.params,
    chainId: e.params.chainId,
    peerName: meta?.name ?? '',
    peerUrl: meta?.url ?? '',
    validation: verify.validation,
    isScam: verify.isScam,
    origin: verify.origin || meta?.url || '',
  };
}

function toProposalView(e: WalletKitTypes.SessionProposal): DappProposalView {
  const meta = e.params.proposer.metadata;
  const verify = readVerify((e as unknown as { verifyContext?: VerifyLike }).verifyContext);
  return {
    id: e.id,
    peerName: meta?.name ?? '',
    peerUrl: meta?.url ?? '',
    peerDescription: meta?.description ?? '',
    peerIcon: meta?.icons?.[0] ?? '',
    validation: verify.validation,
    isScam: verify.isScam,
    origin: verify.origin || meta?.url || '',
  };
}

/** WalletKit を1度だけ初期化して返す。初期化に失敗した時は次回やり直せるよう破棄する。 */
export function getWalletKit(): Promise<IWalletKit> {
  if (!isWalletConnectConfigured()) {
    return Promise.reject(new Error('walletconnect_not_configured'));
  }
  if (!kitPromise) {
    kitPromise = (async () => {
      const core = new Core({ projectId: WC_PROJECT_ID });
      const kit = await WalletKit.init({
        core,
        metadata: {
          name: 'Raccoon Wallet SP',
          description: 'Raccoon Wallet SP',
          url: window.location.origin,
          icons: [],
        },
      });
      const store = useDappStore.getState();
      kit.on('session_proposal', (e: WalletKitTypes.SessionProposal) => {
        useDappStore.getState().setProposal({ raw: e, view: toProposalView(e) });
      });
      kit.on('session_request', (e: WalletKitTypes.SessionRequest) => {
        useDappStore.getState().pushRequest(toRequestView(kit, e));
      });
      // オフライン中に届いて未処理のままのリクエストがあれば拾う。
      for (const pending of kit.getPendingSessionRequests() ?? []) {
        store.pushRequest(toRequestView(kit, pending as unknown as WalletKitTypes.SessionRequest));
      }
      return kit;
    })().catch((e) => {
      kitPromise = null;
      throw e;
    });
  }
  return kitPromise;
}

/** dApp が表示した wc: URI で接続を始める。承認画面は 'session_proposal' で出る。 */
export async function pairWithUri(uri: string): Promise<void> {
  const trimmed = uri.trim();
  if (!trimmed.startsWith('wc:')) {
    throw new Error('invalid_uri');
  }
  const kit = await getWalletKit();
  await kit.pair({ uri: trimmed });
}

export type NamespaceResult =
  | { ok: true; namespaces: ReturnType<typeof buildApprovedNamespaces> }
  | { ok: false; message: string };

/**
 * dApp の要求(必須チェーン・必須メソッド)がこのアプリの対応範囲に収まるか確かめ、
 * 収まるなら承認用の namespaces を作る。収まらなければ理由を返す。
 */
export function buildNamespacesFor(rawProposal: unknown, address: string): NamespaceResult {
  const proposal = rawProposal as WalletKitTypes.SessionProposal;
  const chains = supportedChains().map((c) => c.caip);
  try {
    const namespaces = buildApprovedNamespaces({
      proposal: proposal.params,
      supportedNamespaces: {
        eip155: {
          chains,
          methods: [...SUPPORTED_METHODS],
          events: [...SUPPORTED_EVENTS],
          accounts: chains.map((c) => `${c}:${address}`),
        },
      },
    });
    return { ok: true, namespaces };
  } catch (e) {
    return { ok: false, message: (e as Error | null)?.message ?? 'unsupported' };
  }
}

export async function approveProposal(rawProposal: unknown, address: string): Promise<void> {
  const proposal = rawProposal as WalletKitTypes.SessionProposal;
  const built = buildNamespacesFor(proposal, address);
  if (!built.ok) {
    throw new Error(built.message);
  }
  const kit = await getWalletKit();
  await kit.approveSession({ id: proposal.id, namespaces: built.namespaces });
  useDappStore.getState().setProposal(null);
}

export async function rejectProposal(rawProposal: unknown): Promise<void> {
  const proposal = rawProposal as WalletKitTypes.SessionProposal;
  const kit = await getWalletKit();
  try {
    await kit.rejectSession({ id: proposal.id, reason: getSdkError('USER_REJECTED') });
  } finally {
    useDappStore.getState().setProposal(null);
  }
}

export async function respondResult(req: { topic: string; id: number }, result: unknown): Promise<void> {
  const kit = await getWalletKit();
  await kit.respondSessionRequest({ topic: req.topic, response: { id: req.id, jsonrpc: '2.0', result } });
  useDappStore.getState().removeRequest(req.id);
}

export type SdkErrorKey = 'USER_REJECTED' | 'WC_METHOD_UNSUPPORTED' | 'UNSUPPORTED_CHAINS' | 'UNSUPPORTED_ACCOUNTS';

export async function respondSdkError(req: { topic: string; id: number }, key: SdkErrorKey): Promise<void> {
  const kit = await getWalletKit();
  try {
    await kit.respondSessionRequest({ topic: req.topic, response: { id: req.id, jsonrpc: '2.0', error: getSdkError(key) } });
  } finally {
    useDappStore.getState().removeRequest(req.id);
  }
}

/** 送信に失敗した時など、メッセージ付きでエラーを返す。 */
export async function respondFailure(req: { topic: string; id: number }, message: string): Promise<void> {
  const kit = await getWalletKit();
  try {
    await kit.respondSessionRequest({ topic: req.topic, response: { id: req.id, jsonrpc: '2.0', error: { code: -32000, message } } });
  } finally {
    useDappStore.getState().removeRequest(req.id);
  }
}

export async function listSessions(): Promise<DappSession[]> {
  const kit = await getWalletKit();
  return Object.values(kit.getActiveSessions());
}

export async function disconnectSession(topic: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') });
}

/** WalletKit の session_delete(dApp 側から切断された)を画面に知らせる購読。解除関数を返す。 */
export async function onSessionsChanged(cb: () => void): Promise<() => void> {
  const kit = await getWalletKit();
  kit.on('session_delete', cb);
  return () => {
    kit.off('session_delete', cb);
  };
}

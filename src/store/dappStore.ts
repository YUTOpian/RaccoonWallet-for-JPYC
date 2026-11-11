import { create } from 'zustand';

// dApp(WalletConnect)から届いた「接続の申し込み」と「署名・送信のリクエスト」の待ち行列。
// 画面遷移しても消えないようアプリ全体で1つのストアにしている。永続化はしない
// (リクエストは数分で期限切れになり、再起動後は WalletConnect 側から再配信される)。

export type DappValidation = 'VALID' | 'INVALID' | 'UNKNOWN';

export interface DappProposalView {
  id: number;
  peerName: string;
  peerUrl: string;
  peerDescription: string;
  peerIcon: string;
  /** WalletConnect の Verify API による接続元ドメインの判定。 */
  validation: DappValidation;
  isScam: boolean;
  origin: string;
}

export interface DappRequestView {
  id: number;
  topic: string;
  method: string;
  params: unknown;
  /** 'eip155:137' のような CAIP-2 形式 */
  chainId: string;
  peerName: string;
  peerUrl: string;
  validation: DappValidation;
  isScam: boolean;
  origin: string;
}

interface DappState {
  // 生の proposal は WalletKit の型なので unknown で預かり、承認・拒否の時に lib 側で使う。
  proposal: { raw: unknown; view: DappProposalView } | null;
  requests: DappRequestView[];
  setProposal: (p: { raw: unknown; view: DappProposalView } | null) => void;
  pushRequest: (r: DappRequestView) => void;
  removeRequest: (id: number) => void;
}

export const useDappStore = create<DappState>()((set) => ({
  proposal: null,
  requests: [],
  setProposal: (proposal) => set({ proposal }),
  pushRequest: (r) => set((s) => (s.requests.some((x) => x.id === r.id) ? s : { requests: [...s.requests, r] })),
  removeRequest: (id) => set((s) => ({ requests: s.requests.filter((x) => x.id !== id) })),
}));

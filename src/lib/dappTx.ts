import { ethers } from 'ethers';

/**
 * dApp から届いた eth_sendTransaction の中身を、承認画面で読める形にまとめる。
 * 詐欺で多い「承認(approve / setApprovalForAll)」を見分けて警告するのが主目的で、
 * 解読できない呼び出し(NFTの購入など、マーケットプレイス固有のコントラクト)は
 * 'unknown' として「接続元と金額を確認して」と案内する。
 */

export type TxRisk = 'info' | 'caution' | 'danger';

export type TxKind =
  | 'native_transfer'
  | 'token_transfer'
  | 'approve'
  | 'set_approval_for_all'
  | 'move_from'
  | 'unknown';

export interface TxSummary {
  kind: TxKind;
  risk: TxRisk;
  /** 呼び出された関数のセレクタ(0x + 8桁)。データ無しなら空文字。 */
  selector: string;
  /** 承認先(approve / setApprovalForAll) */
  spender?: string;
  /** 受取先(transfer 系) */
  recipient?: string;
  /** 数量またはトークンIDの生の値(approve / transfer 系) */
  amountRaw?: bigint;
  /** approve の数量が事実上無制限 */
  unlimited?: boolean;
  /** setApprovalForAll の true/false */
  approved?: boolean;
}

export interface DappTxParams {
  from?: string;
  to: string;
  data: string;
  value: bigint;
  gas?: bigint;
}

const IFACE = new ethers.Interface([
  'function transfer(address to, uint256 value)',
  'function approve(address spender, uint256 value)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transferFrom(address from, address to, uint256 value)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
]);

// 数量がこの値以上なら「無制限」とみなす(uint256 の最大値は 2^256-1。慣習的な無制限承認は
// ほぼ最大値だが、少し小さい値で事実上無制限にする dApp もあるため半分を境にする)。
const UNLIMITED_THRESHOLD = 2n ** 255n;

function toBigInt(v: unknown): bigint | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  try {
    return BigInt(v as string | number | bigint);
  } catch {
    return undefined;
  }
}

/** params[0] を検証して取り出す。不正(to が無い=コントラクト作成など)なら null。 */
export function parseTxParams(raw: unknown): DappTxParams | null {
  const tx = Array.isArray(raw) ? (raw[0] as Record<string, unknown> | undefined) : undefined;
  if (!tx || typeof tx !== 'object') return null;
  const to = typeof tx.to === 'string' ? tx.to : '';
  if (!ethers.isAddress(to)) return null;
  const dataRaw = (typeof tx.data === 'string' ? tx.data : typeof tx.input === 'string' ? tx.input : '0x') || '0x';
  if (!ethers.isHexString(dataRaw)) return null;
  const value = toBigInt(tx.value) ?? 0n;
  if (value < 0n) return null;
  return {
    from: typeof tx.from === 'string' ? tx.from : undefined,
    to: ethers.getAddress(to),
    data: dataRaw,
    value,
    gas: toBigInt(tx.gas ?? tx.gasLimit),
  };
}

export function summarizeTx(p: DappTxParams, walletAddress: string): TxSummary {
  if (p.data === '0x') {
    return { kind: 'native_transfer', risk: 'info', selector: '', recipient: p.to };
  }
  const selector = p.data.slice(0, 10).toLowerCase();
  let parsed: ethers.TransactionDescription | null = null;
  try {
    parsed = IFACE.parseTransaction({ data: p.data, value: p.value });
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return { kind: 'unknown', risk: 'caution', selector };
  }
  const args = parsed.args;
  const mine = (a: string) => a.toLowerCase() === walletAddress.toLowerCase();

  switch (parsed.name) {
    case 'transfer':
      return { kind: 'token_transfer', risk: 'info', selector, recipient: String(args[0]), amountRaw: BigInt(args[1]) };
    case 'approve':
    case 'increaseAllowance': {
      const amount = BigInt(args[1]);
      const unlimited = amount >= UNLIMITED_THRESHOLD;
      return { kind: 'approve', risk: unlimited ? 'danger' : 'caution', selector, spender: String(args[0]), amountRaw: amount, unlimited };
    }
    case 'setApprovalForAll': {
      const approved = Boolean(args[1]);
      // true: 保有している全てのNFTの操作権限を渡す(詐欺で最も多い手口)。false は取り消し。
      return { kind: 'set_approval_for_all', risk: approved ? 'danger' : 'info', selector, spender: String(args[0]), approved };
    }
    case 'transferFrom':
    case 'safeTransferFrom': {
      const from = String(args[0]);
      const to = String(args[1]);
      return {
        kind: 'move_from',
        // 自分のトークン/NFTを他へ移す操作。
        risk: mine(from) ? 'caution' : 'info',
        selector,
        recipient: to,
        amountRaw: BigInt(args[2]),
      };
    }
    default:
      return { kind: 'unknown', risk: 'caution', selector };
  }
}

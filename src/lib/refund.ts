import { Decimal } from 'decimal.js';
import { isEvmChainKey, TOKEN_LISTS } from './chains';
import { CustomTokensHelper } from './storage';
import type { TransactionWrapper } from './transactionWrapper';

// 受け取った取引の「返金」: 同じ額を、同じチェーン・同じ通貨で、送り主へ返す送金画面を開く。
// 送金そのものは通常の送金確認画面(PIN・ガスレス・宛先の安全確認つき)を通すので、
// ここでは「何を送るか」を割り出すだけ。履歴は通貨名(JPYCなど)しか持たないので、
// トークンのコントラクトは、一覧に載っているものか、手で登録したものから探す。

export type RefundAsset =
  | { kind: 'jpyc' }
  | { kind: 'token'; meta: { address: string; symbol: string; decimals: number } };

export async function resolveRefundAsset(chain: string, symbol: string): Promise<RefundAsset | null> {
  if (isEvmChainKey(chain)) {
    if (symbol === 'JPYC') return { kind: 'jpyc' };
    const listed = TOKEN_LISTS[chain].find((t) => t.symbol === symbol);
    if (listed) return { kind: 'token', meta: { address: listed.address, symbol: listed.symbol, decimals: listed.decimals } };
  }
  const custom = (await CustomTokensHelper.list(chain)).find((t) => t.symbol === symbol);
  if (custom) return { kind: 'token', meta: { address: custom.address, symbol: custom.symbol, decimals: custom.decimals } };
  return null;
}

/** 返金できる取引か(確認済みの受け取りで、返す先が分かる)。 */
export function isRefundable(transaction: TransactionWrapper): boolean {
  return transaction.isReception && transaction.isConfirmed && /^0x[0-9a-fA-F]{40}$/.test(transaction.senderAddress);
}

/** 履歴の金額表記(1000.0 など)を、送金画面の入力形式(1000)にそろえる。 */
export function refundAmount(transaction: TransactionWrapper): string {
  return new Decimal(transaction.amount.replace(/,/g, '') || '0').toFixed();
}

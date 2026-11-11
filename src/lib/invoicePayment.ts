import { Decimal } from 'decimal.js';
import { CHAINS, fetchRecentJpycTransfers, getProvider } from './chains';
import type { ChainKey, ChainTransfer } from './chains';
import type { InvoicePayload } from './invoice';
import { payloadTotals } from './invoice';
import type { InvoiceRecord } from './storage';

/** The curated chain with this chainId in the *current* network mode, if any. */
export function chainKeyForId(chainId: number): ChainKey | null {
  return (Object.keys(CHAINS) as ChainKey[]).find((key) => CHAINS[key].chainId === chainId) ?? null;
}

/**
 * Current block height, used to anchor an invoice's payment search. Gives up after a few
 * seconds and returns 0 (= "unknown", the search then falls back to timestamps) rather than
 * letting a dead RPC block issuing the invoice.
 */
export async function readStartBlock(chain: ChainKey, timeoutMs = 6000): Promise<number> {
  try {
    return await Promise.race([
      getProvider(chain).getBlockNumber(),
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
  } catch (e) {
    console.error('Could not read the current block for an invoice, falling back to timestamps', e);
    return 0;
  }
}

/**
 * Looks for the payment of an open invoice: an incoming JPYC transfer to the invoice's
 * address, made after the invoice was issued, for exactly the invoiced total, that hasn't
 * already settled another invoice. Exact-amount matching is deliberate - the wallet may be
 * receiving unrelated JPYC all the time, so summing everything that arrives (as the QR
 * checkout screens do over their short waiting window) would wrongly settle a weeks-old
 * invoice. Anything that doesn't match exactly (partial or split payments, a different
 * amount) is left for the issuer to confirm by hand.
 *
 * Returns the earliest matching transfer, or null. Callers should treat it as a candidate to
 * confirm, not as proof.
 */
export async function findInvoicePayment(
  record: InvoiceRecord,
  payload: InvoicePayload,
  chain: ChainKey,
  alreadyUsedHashes: Set<string>,
): Promise<ChainTransfer | null> {
  const total = new Decimal(payloadTotals(payload).total);
  const transfers = await fetchRecentJpycTransfers(chain, payload.a, 100);
  const matches = transfers.filter((tr) => {
    if (!tr.isReception) return false;
    if (alreadyUsedHashes.has(tr.hash.toLowerCase())) return false;
    const after = record.startBlock > 0
      ? tr.blockNumber > record.startBlock
      : tr.timestamp * 1000 >= record.createdAt - 60_000;
    if (!after) return false;
    return new Decimal(tr.amount).equals(total);
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.blockNumber - b.blockNumber);
  return matches[0];
}

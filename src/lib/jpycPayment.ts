import { Decimal } from 'decimal.js';
import { ethers } from 'ethers';
import { CHAINS } from './chains';
import type { ChainKey } from './chains';

// Builds an EIP-681 ERC-20 transfer request URI for an exact token amount due, so a scanning
// wallet can pre-fill both the recipient and the amount instead of the buyer having to type
// them in by hand. `decimals` should be read from the token contract itself (see
// getJpycDecimals in lib/chains.ts) rather than assumed, since it's the one thing here that
// isn't hardcoded chain config.
//
// Shared by every "generate a payment QR" screen in the app — MarketplaceCollect (売り物リ
// スト), QRGeneratorCollect (QR Lab's 指定金額を受け取る), and QRRegister (QRレジスター) —
// so all three produce identical, wallet-compatible QR codes instead of each rolling their own
// slightly different format. `tokenAddress` defaults to this chain's JPYC contract, which is
// what every caller used before 表示通貨 (display currency) existed; QRGeneratorCollect/
// QRRegister pass the chain's USDC contract instead when 表示通貨 is set to USD.
export function buildJpycPaymentUri(
  chain: ChainKey,
  to: string,
  amount: Decimal,
  decimals: number,
  tokenAddress: string = CHAINS[chain].jpycAddress,
): string {
  if (!to || amount.lessThanOrEqualTo(0)) return to;
  try {
    const raw = ethers.parseUnits(amount.toFixed(decimals), decimals);
    return `ethereum:${tokenAddress}@${CHAINS[chain].chainId}/transfer?address=${to}&uint256=${raw.toString()}`;
  } catch (e) {
    console.error('Failed to build payment URI, falling back to bare address', e);
    return to;
  }
}

// A bare address (no @<chainId>) doesn't tell a scanning wallet which chain to use, so
// nothing stops the sender from sending on the wrong one. This locks the QR to a specific
// chain the same way buildJpycPaymentUri does, but without requiring an amount - the
// scanning side (parseEip681PaymentUri + Scan.tsx) still reads the chain id and switches the
// sender's active chain to match, it just treats it as an address-only request rather than a
// specific-amount one.
export function buildChainLockedAddressUri(chain: ChainKey, to: string): string {
  if (!to) return to;
  return `ethereum:${to}@${CHAINS[chain].chainId}`;
}

// Same idea as buildChainLockedAddressUri above, but for a network that isn't in the
// curated CHAINS registry - a chain added by hand under 設定 > カスタムEVM (see
// CustomChainRecord in lib/storage.ts). Takes the numeric chainId directly instead of
// looking it up from ChainKey, since a custom chain has no ChainKey to look up.
export function buildChainLockedAddressUriForChainId(chainId: number, to: string): string {
  if (!to) return to;
  return `ethereum:${to}@${chainId}`;
}

// Counterpart to buildJpycPaymentUri above, for the *scanning* side (Scan.tsx). Previously
// Scan.tsx only pulled a bare 0x... address out of a scanned EIP-681 URI with a regex and
// silently dropped everything else, so an amount encoded in a QR code we (or another wallet)
// generated never made it into the app's own Send flow ("amount doesn't auto-fill" bug).
// This parses the actual EIP-681 grammar (schema_prefix / target_address / chain_id /
// function_name / parameters — https://eips.ethereum.org/EIPS/eip-681) so the amount and
// chain travel along with the address.
//
// Only the "no function name" (native currency) and "transfer" (ERC-20, matching what
// buildJpycPaymentUri emits) shapes are recognized — other function calls (approve, etc.)
// aren't send-flow payment requests and are left for the caller to fall back on
// address-only handling.
export interface ParsedEip681Payment {
  // Chain the URI specified via @<chainId>, matched against this app's known chains.
  // null if the URI omitted a chain id, or specified one this app doesn't support.
  chain: ChainKey | null;
  isNative: boolean;
  // ERC-20 contract address being called; null for a native-currency request.
  tokenAddress: string | null;
  recipientAddress: string;
  // Amount in atomic/wei units, exactly as EIP-681 specifies. null if the URI carried no
  // amount at all (a bare address-only payment request), which the caller should treat the
  // same as scanning a plain address.
  rawAmount: bigint | null;
}

const EIP681_RE = /^ethereum:(?:pay-)?(0x[a-fA-F0-9]{40})(?:@(\d+))?(?:\/([a-zA-Z_][a-zA-Z0-9_]*))?(?:\?(.*))?$/;

export function parseEip681PaymentUri(uri: string): ParsedEip681Payment | null {
  const match = uri.trim().match(EIP681_RE);
  if (!match) return null;
  const [, targetAddress, chainIdStr, functionName, queryString] = match;

  const chainId = chainIdStr ? Number(chainIdStr) : null;
  const chain = chainId !== null
    ? (Object.keys(CHAINS) as ChainKey[]).find((key) => CHAINS[key].chainId === chainId) ?? null
    : null;

  const params = new URLSearchParams(queryString ?? '');

  if (functionName === 'transfer') {
    const recipient = params.get('address');
    if (!recipient || !ethers.isAddress(recipient)) return null;
    const uint256 = params.get('uint256');
    let rawAmount: bigint | null = null;
    if (uint256) {
      try {
        rawAmount = BigInt(uint256);
      } catch {
        return null; // malformed amount (e.g. scientific notation like "1e21") - bail out
      }
    }
    return {
      chain,
      isNative: false,
      tokenAddress: ethers.getAddress(targetAddress),
      recipientAddress: ethers.getAddress(recipient),
      rawAmount,
    };
  }

  // Any other named function (approve, etc.) isn't a payment request this app understands.
  if (functionName) return null;

  const value = params.get('value');
  let rawAmount: bigint | null = null;
  if (value) {
    try {
      rawAmount = BigInt(value);
    } catch {
      return null;
    }
  }
  return {
    chain,
    isNative: true,
    tokenAddress: null,
    recipientAddress: ethers.getAddress(targetAddress),
    rawAmount,
  };
}

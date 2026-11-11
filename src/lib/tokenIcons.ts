import iconUsdt from '../assets/icon_token_usdt.png';
import iconUsdc from '../assets/icon_token_usdc.png';
import iconJpyc from '../assets/icon_token_jpyc.png';

// Logos for the handful of ERC-20 tokens every swap-supported chain offers (see
// STABLECOINS/JPYC in lib/uniswap.ts) - native coins already have their own per-chain logo
// via CHAIN_ICONS in lib/chainIcons.ts, so this only needs to cover the non-native side.
// Keyed by symbol rather than address since the same stablecoin's contract address differs
// per chain but its logo doesn't.
const TOKEN_ICONS: Record<string, string> = {
  USDT: iconUsdt,
  USDC: iconUsdc,
  JPYC: iconJpyc,
};

// Returns the logo for a given token symbol, or null when we don't have curated artwork for
// it - callers fall back to a plain letter avatar in that case (e.g. an unrecognized custom
// token) rather than showing a broken image.
export function getTokenIcon(symbol: string): string | null {
  return TOKEN_ICONS[symbol.toUpperCase()] ?? null;
}

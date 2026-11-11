import { resolveSigner } from './signer';
import type { SignerSource } from './signer';
import { Contract, ethers } from 'ethers';
import { CHAINS, getProvider, withRpcFallback, getGasOverrides, getJpycContract, extractRpcMessage } from './chains';
import type { ChainKey, TokenInfo } from './chains';

/**
 * Uniswap V4 swap support.
 *
 * V4 replaces V3's "one contract per pool" model with a singleton design: every pool's state
 * lives inside one PoolManager contract, pools are identified by a PoolKey (currency0, currency1,
 * fee, tickSpacing, hooks) rather than a deployed address, and swaps are executed through the
 * Universal Router (which talks to PoolManager on the caller's behalf) instead of a dedicated
 * SwapRouter. Unlike V3, native ETH/POL/AVAX is represented directly inside a pool as the zero
 * address - there's no wrapped-native token to route through, so no wrap/unwrap step is needed
 * anywhere in this file. ERC-20 inputs are pulled via Permit2 rather than a plain ERC-20
 * allowance directly on the router, which is why ensurePermit2Allowance below is a two-step
 * approval (wallet -> Permit2, then Permit2 -> Universal Router) instead of V3's one-step
 * approve(). This migration matters in practice, not just architecturally: as of mid-2026 JPYC's
 * most liquid on-chain pairs (JPYC/USDC on Ethereum, Polygon and Avalanche) sit in V4 pools, with
 * V3 liquidity for the same pairs largely dried up - see the deployment addresses below and the
 * function docs for how the JPYC-hub routing this file already did for V3 carries over unchanged.
 *
 * PoolManager/V4Quoter/UniversalRouter addresses are sourced from Uniswap's own deployments
 * listing (https://developers.uniswap.org/deployments) and are per-chain rather than shared -
 * unlike V3's CREATE2-deterministic addresses, V4 has NOT been deployed at the same address on
 * every chain, so (as before) each is looked up per-chain rather than assumed to match. Permit2
 * is the one exception - Uniswap and most of the ecosystem share a single canonical Permit2
 * deployment at the same address on every EVM chain.
 * Uniswap has no official V4 deployment on Kaia, so - exactly as with V3 before it - swapping is
 * intentionally unsupported there: isSwapSupported() below is the single gate every swap entry
 * point (Home, SwapTop, SwapConfirmation) checks before allowing the flow to proceed, and the
 * pool manager/quoter/router addresses are simply never resolved for any other chain.
 */
export type SwapChain = Extract<ChainKey, 'ethereum' | 'polygon' | 'avalanche'>;

export function isSwapSupported(chain: ChainKey): chain is SwapChain {
  return chain === 'ethereum' || chain === 'polygon' || chain === 'avalanche';
}

export const SWAP_CHAINS: SwapChain[] = ['ethereum', 'polygon', 'avalanche'];

/**
 * On Ethereum and Avalanche, in practice only the JPYC<->USDC pool is reliably liquid - most
 * other pairs have no quotable pool at all, even after fetchSwapQuote's own USDT/USDC-routed
 * fallback is tried (see fetchSwapQuote below). This flags those two chains so SwapTop can
 * apply a further, more aggressive fallback there instead of just surfacing "no route" to the
 * person - see resolveForcedHubCounterpart.
 */
export function usesForcedHubFallback(chain: SwapChain): boolean {
  return chain === 'ethereum' || chain === 'avalanche';
}

/**
 * The token to substitute in for whichever side of the pair the person did NOT just pick,
 * once even the ordinary routed quote (fetchSwapQuote) has failed to find any pool at all for
 * their chosen pair - see usesForcedHubFallback. `fixed` is the side the person actually
 * chose (the "from" token if they picked that first, otherwise the "to" token); the result is
 * always either JPYC or USDC, whichever forms the one reliably-liquid pair with `fixed`:
 *  - fixed is JPYC -> USDC (the two ends of the one pool known to work)
 *  - fixed is anything else (including USDC itself) -> JPYC
 * This mirrors the same rule regardless of which side was picked first: pick a "from" token,
 * and the trade settles in JPYC (routed via USDC under the hood, or directly if the "from"
 * token is USDC itself); pick a "to" token, and the trade is funded from JPYC (again via USDC,
 * or directly if the "to" token is USDC itself).
 * Returns null if the wallet's token list for this chain doesn't include one of them - should
 * not normally happen, since getSwapTokens always includes both JPYC and USDC.
 */
export function resolveForcedHubCounterpart(tokens: SwapToken[], fixed: SwapToken): SwapToken | null {
  const wantSymbol = fixed.symbol === 'JPYC' ? 'USDC' : 'JPYC';
  return tokens.find((tk) => tk.symbol === wantSymbol) ?? null;
}

// Uniswap v4 core/periphery deployment addresses, per chain - see the class doc above for why
// these aren't shared across chains the way Permit2's address is. (PoolManager itself,
// 0x000000000004444c5dc75cB358380D2e3dE08A90 on Ethereum, isn't listed here since nothing in
// this file talks to it directly - V4Quoter and the Universal Router both reference it
// internally, which is all quoting and swapping ever need.)
const V4_QUOTER: Record<SwapChain, string> = {
  ethereum: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
  polygon: '0xb3d5c3Dfc3a7aEbFF71895A7191796BFFc2c81b9',
  avalanche: '0xbE40675BB704506a3c2Ccfb762DCFd1e979845C2',
};
const UNIVERSAL_ROUTER: Record<SwapChain, string> = {
  ethereum: '0x66a9893cC07D91D95644AedD05D03f95e1dBa8aF',
  polygon: '0x1095692A6237d83C6a72F3F5eFEDb9A670C49223',
  avalanche: '0x94b75331aE8d42c1b61065089B7d48FE14aa73b7',
};
// Permit2 is deployed at this same address on every EVM chain Uniswap (and most of the wider
// ecosystem) supports - see https://github.com/Uniswap/permit2.
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// v4 represents a chain's native coin directly inside a pool via this sentinel address, instead
// of V3's approach of only ever holding a wrapped ERC-20 (WETH9/WMATIC/WAVAX) inside the pool -
// getSwapTokens below gives the native SwapToken this as its `address` for that reason.
const NATIVE_CURRENCY = ethers.ZeroAddress;

// The standard tick spacing Uniswap's own interface pairs with each of these fee tiers. v4 pools
// can in principle use any tickSpacing per fee, but every pool actually created through
// app.uniswap.org - and therefore every pool any real JPYC/USDT/USDC liquidity actually sits in -
// uses these, exactly as V3 did.
const FEE_TIERS = [3000, 500, 10000, 100] as const;
const TICK_SPACING: Record<number, number> = { 500: 10, 3000: 60, 10000: 200, 100: 1 };

const V4_QUOTER_ABI = [
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)',
];

const UNIVERSAL_ROUTER_ABI = ['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'];

// AllowanceTransfer.allowance/approve - the plain on-chain (non-signature) half of Permit2 used
// below. This is the same style of call as a normal ERC-20 approve, just aimed at Permit2's own
// internal allowance table instead of a token contract's - see ensurePermit2Allowance.
const PERMIT2_ABI = [
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
];

const ERC20_ALLOWANCE_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// Universal Router command byte for "run a v4 swap" - see Commands.sol in the universal-router repo.
const CMD_V4_SWAP = 0x10;
// V4Router action bytes used below - see Actions.sol in v4-periphery. Only the few this file
// actually needs: run an exact-input single-hop swap, pay what's owed for the input currency,
// then collect whatever came out the other side.
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
const ACTION_SETTLE_ALL = 0x0c;
const ACTION_TAKE_ALL = 0x0f;
// ActionConstants.OPEN_DELTA - passing this (0) as a swap action's amountIn tells V4Router to use
// whatever the contract is already owed from the previous action in the same call, instead of a
// fixed amount. Used below to chain a routed swap's second leg directly off the first leg's
// actual output, without needing to know that output ahead of time - see executeSwap.
const OPEN_DELTA = 0n;

const MAX_UINT160 = (1n << 160n) - 1n; // Permit2 allowances are stored as uint160, not uint256.

// The full set of ERC-20 currencies offered on the swap screen for a given chain: JPYC
// (below) plus USDT/USDC here. Deliberately hardcoded rather than reusing lib/chains.ts's
// TOKEN_LISTS - that list also carries DAI/WBTC/LINK/UNI, kept for the general balance
// screen but not offered for swapping here - and independent of the app's mainnet/debug
// network-mode toggle, under which TOKEN_LISTS goes empty since those addresses aren't
// guaranteed to exist on testnets. Uniswap swapping itself only ever targets these tokens'
// real mainnet contracts (the pool manager/quoter/router addresses above are themselves
// mainnet-only deployments), so keeping this list separate keeps it correct either way.
const STABLECOINS: Record<SwapChain, TokenInfo[]> = {
  ethereum: [
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  polygon: [
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
  avalanche: [
    { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  ],
};

export interface SwapToken extends TokenInfo {
  // True for the pseudo-token representing the chain's native coin (ETH / POL / AVAX). Its
  // `address` field is NATIVE_CURRENCY (the zero address) - that's how v4 itself represents
  // native currency inside a pool, valid as either tokenIn (paid via the Universal Router's own
  // msg.value, settled with no Permit2 step - see executeSwap) or tokenOut (TAKE_ALL sends it
  // back out as plain native currency, again with no unwrap step needed).
  isNative?: boolean;
}

/**
 * Every currency offered on the swap screen for a given (already-confirmed-supported)
 * chain: the native coin, JPYC, and USDT/USDC (see STABLECOINS above). This is the full
 * candidate set before liquidity-based filtering - use buildPoolabilityMap() to find out
 * which pairs among these actually have a pool. JPYC's decimals are read live (as
 * lib/chains.ts does elsewhere) rather than assumed.
 */
export async function getSwapTokens(chain: SwapChain): Promise<SwapToken[]> {
  const config = CHAINS[chain];

  const native: SwapToken = {
    address: NATIVE_CURRENCY,
    symbol: config.nativeCurrency.symbol,
    name: config.nativeCurrency.name,
    decimals: config.nativeCurrency.decimals,
    isNative: true,
  };

  let jpycDecimals = 18;
  try {
    jpycDecimals = Number(await getJpycContract(chain).decimals());
  } catch (e) {
    console.warn(`Failed to read JPYC decimals on ${chain} for swap token list, defaulting to 18`, e);
  }
  const jpyc: SwapToken = {
    address: config.jpycAddress,
    symbol: 'JPYC',
    name: 'JPY Coin',
    decimals: jpycDecimals,
  };

  return [native, jpyc, ...STABLECOINS[chain]];
}

// A v4 PoolKey - currency0 must be the numerically smaller address of the pair (the zero address
// representing native currency always sorts first), which is why buildPoolKey below sorts the
// two addresses rather than assuming the caller already passed them in that order.
interface PoolKeyStruct {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

/**
 * Builds the PoolKey for a (tokenA, tokenB, fee) triple - v4 identifies a pool by this struct
 * rather than a deployed address, and requires currency0 < currency1 by numeric address value.
 * Also returns whether swapping FROM tokenA moves the pool "zero for one" (true) or "one for
 * zero" (false), since every action below needs that alongside the key itself. Only pools with
 * no hooks are ever used here - this wallet only ever targets the plain, hookless pools that
 * exactly mirror what a V3 pool used to be, not any of v4's custom-hook pools.
 */
function buildPoolKey(tokenA: string, tokenB: string, fee: number): { key: PoolKeyStruct; zeroForOne: boolean } {
  const aIsLower = tokenA.toLowerCase() < tokenB.toLowerCase();
  const [currency0, currency1] = aIsLower ? [tokenA, tokenB] : [tokenB, tokenA];
  return {
    key: { currency0, currency1, fee, tickSpacing: TICK_SPACING[fee], hooks: ethers.ZeroAddress },
    zeroForOne: aIsLower,
  };
}

/**
 * Whether a Uniswap v4 pool exists for this pair at any of FEE_TIERS, probed by attempting a
 * quote for a small nominal amount at each tier in parallel (v4 has no direct per-pool contract
 * or factory to query for existence the way V3 did, so a quote attempt doubles as the existence
 * check - see fetchSingleHopQuote, which this delegates to). The probe amount is a fixed 10^12
 * raw units regardless of the pair's actual decimals - meaningless as a real trade size, but
 * fine for "does this pool have any liquidity at all" since the real, accurate quote for the
 * person's actual amount is always fetched separately via fetchSwapQuote before anything is
 * shown or executed.
 */
export async function hasPool(chain: SwapChain, tokenA: string, tokenB: string): Promise<boolean> {
  const probeAmountRaw = 10n ** 12n;
  const results = await Promise.all(
    FEE_TIERS.map(async (fee) => {
      try {
        return (await fetchSingleHopQuote(chain, tokenA, tokenB, probeAmountRaw, fee)) !== null;
      } catch {
        return false;
      }
    }),
  );
  return results.some(Boolean);
}

/**
 * For every pair among `tokens`, checks whether a Uniswap v4 pool exists (in parallel across
 * all pairs, each of which itself checks its fee tiers in parallel - see hasPool) and
 * returns the result as a symmetric adjacency map keyed by lowercased address, so a caller
 * can look up "which of these tokens can tokenX actually be swapped for" in O(1). Intended
 * to gate the swap screen's token-out selector by whatever's chosen as tokenIn, and vice
 * versa, so the person is never offered a pair with no route between them.
 */
export async function buildPoolabilityMap(chain: SwapChain, tokens: SwapToken[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  tokens.forEach((t) => map.set(t.address.toLowerCase(), new Set()));

  const pairs: [SwapToken, SwapToken][] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      pairs.push([tokens[i], tokens[j]]);
    }
  }

  await Promise.all(
    pairs.map(async ([a, b]) => {
      if (await hasPool(chain, a.address, b.address)) {
        map.get(a.address.toLowerCase())!.add(b.address.toLowerCase());
        map.get(b.address.toLowerCase())!.add(a.address.toLowerCase());
      }
    }),
  );

  return map;
}

/**
 * Extends buildPoolabilityMap's direct-pool adjacency by also connecting any two tokens that
 * each have a direct pool with the same USDT/USDC intermediary, even when there's no direct
 * pool between the two of them - e.g. if JPYC/AVAX has no pool but JPYC/USDC and USDC/AVAX
 * both do, AVAX can still reach JPYC by routing through USDC (see fetchSwapQuote's routing
 * fallback and executeSwap's multi-hop path below). Used to decide which pairs to even offer
 * as selectable on the swap screen, so an indirectly-quotable pair isn't hidden just because
 * it has no direct pool - only genuinely unreachable pairs are excluded.
 */
export async function buildSwappabilityMap(chain: SwapChain, tokens: SwapToken[]): Promise<Map<string, Set<string>>> {
  const poolMap = await buildPoolabilityMap(chain, tokens);
  const map = new Map<string, Set<string>>();
  poolMap.forEach((partners, addr) => map.set(addr, new Set(partners)));

  const intermediaryAddrs = STABLECOINS[chain]
    .map((tk) => tk.address.toLowerCase())
    .filter((addr) => poolMap.has(addr));

  for (const interAddr of intermediaryAddrs) {
    const partnersOfInter = Array.from(poolMap.get(interAddr) ?? []);
    for (let i = 0; i < partnersOfInter.length; i++) {
      for (let j = i + 1; j < partnersOfInter.length; j++) {
        const a = partnersOfInter[i];
        const b = partnersOfInter[j];
        map.get(a)?.add(b);
        map.get(b)?.add(a);
      }
    }
  }
  return map;
}

// Describes the USDT/USDC leg a routed (non-direct) quote went through - carried on SwapQuote
// so SwapConfirmation/SwapTop can show "routed via USDC" and executeSwap can rebuild the same
// path for the actual transaction.
export interface SwapRouteHop {
  intermediary: SwapToken;
  feeIn: number; // fee tier for the tokenIn -> intermediary leg
  feeOut: number; // fee tier for the intermediary -> tokenOut leg
}

export interface SwapQuote {
  amountOut: string; // formatted, in tokenOut's decimals
  feeTier: number; // the fee tier (in hundredths of a bip, e.g. 3000 = 0.3%) that had liquidity
  // for a direct quote; 0 and unused when `route` is set (the path carries
  // both legs' fee tiers instead).
  route?: SwapRouteHop; // present when no direct pool existed and the quote instead routes
  // through a USDT/USDC intermediary - see fetchSwapQuote.
}

/**
 * Quotes a single Uniswap v4 hop (tokenIn -> tokenOut) by trying each fee tier in FEE_TIERS
 * until one resolves, via V4Quoter.quoteExactInputSingle - v4's equivalent of V3's
 * QuoterV2.quoteExactInputSingle, simulated the same way (a non-view function called via
 * .staticCall so it never sends a transaction or costs gas; V4Quoter internally reverts with
 * the quoted amount encoded in the revert data, same trick QuoterV2 used). Returns null if no
 * fee tier has a quotable pool for this pair.
 *
 * Each fee tier is tried via withRpcFallback (lib/chains.ts) rather than a single
 * getProvider(chain) instance, so a transient failure from this chain's first-listed RPC
 * endpoint (rate limit, timeout, a malformed response) doesn't get misread as "no pool at
 * this fee tier" - it's retried against the chain's other configured endpoints first. Without
 * this, a single flaky endpoint makes every pair on that chain, both direct and routed via
 * USDT/USDC, look like it has no liquidity anywhere.
 */
async function fetchSingleHopQuote(
  chain: SwapChain,
  tokenInAddress: string,
  tokenOutAddress: string,
  amountInRaw: bigint,
  onlyFee?: number,
): Promise<{ amountOutRaw: bigint; fee: number } | null> {
  // Normally tries every fee tier in FEE_TIERS; hasPool passes a specific `onlyFee` instead, so
  // it can probe all tiers for all pairs concurrently rather than tier-by-tier per pair.
  const feesToTry = onlyFee !== undefined ? [onlyFee] : FEE_TIERS;

  for (const fee of feesToTry) {
    try {
      const { key, zeroForOne } = buildPoolKey(tokenInAddress, tokenOutAddress, fee);
      const result = await withRpcFallback(chain, (provider) => {
        const quoter = new Contract(V4_QUOTER[chain], V4_QUOTER_ABI, provider);
        return quoter.quoteExactInputSingle.staticCall({
          poolKey: key,
          zeroForOne,
          exactAmount: amountInRaw,
          hookData: '0x',
        });
      });
      return { amountOutRaw: result[0] as bigint, fee };
    } catch {
      // No pool (or no liquidity) at this fee tier for this pair, on every configured RPC
      // endpoint for this chain - try the next fee tier.
      continue;
    }
  }
  return null;
}

/**
 * Quotes swapping `amountIn` of tokenIn for tokenOut. Tries a direct pool first
 * (fetchSingleHopQuote above); if none exists or has liquidity, falls back to routing through
 * whichever of USDT/USDC (see STABLECOINS) gives the best two-leg output - tokenIn ->
 * intermediary, then intermediary -> tokenOut, quoted as two sequential single-hop quotes (the
 * second leg's amountIn is the first leg's quoted amountOut). Both intermediaries are tried in
 * parallel and the higher-output route wins; an intermediary that IS tokenIn or tokenOut is
 * skipped, since routing through the token itself would be meaningless. Returns null if
 * there's no direct pool and no viable two-leg route either.
 */
export async function fetchSwapQuote(
  chain: SwapChain,
  tokenIn: SwapToken,
  tokenOut: SwapToken,
  amountIn: string,
): Promise<SwapQuote | null> {
  const amountInRaw = ethers.parseUnits(amountIn, tokenIn.decimals);
  if (amountInRaw <= 0n) return null;

  const direct = await fetchSingleHopQuote(chain, tokenIn.address, tokenOut.address, amountInRaw);
  if (direct) {
    return { amountOut: ethers.formatUnits(direct.amountOutRaw, tokenOut.decimals), feeTier: direct.fee };
  }

  const candidates = STABLECOINS[chain].filter(
    (tk) =>
      tk.address.toLowerCase() !== tokenIn.address.toLowerCase() &&
      tk.address.toLowerCase() !== tokenOut.address.toLowerCase(),
  );

  const routed = await Promise.all(
    candidates.map(async (intermediary) => {
      const leg1 = await fetchSingleHopQuote(chain, tokenIn.address, intermediary.address, amountInRaw);
      if (!leg1) return null;
      const leg2 = await fetchSingleHopQuote(chain, intermediary.address, tokenOut.address, leg1.amountOutRaw);
      if (!leg2) return null;
      return { amountOutRaw: leg2.amountOutRaw, route: { intermediary, feeIn: leg1.fee, feeOut: leg2.fee } };
    }),
  );

  const best = routed
    .filter((r): r is { amountOutRaw: bigint; route: SwapRouteHop } => r !== null)
    .sort((a, b) => (b.amountOutRaw > a.amountOutRaw ? 1 : b.amountOutRaw < a.amountOutRaw ? -1 : 0))[0];

  if (!best) return null;
  return { amountOut: ethers.formatUnits(best.amountOutRaw, tokenOut.decimals), feeTier: 0, route: best.route };
}

/**
 * Grants the Universal Router permission to pull `amount` of an ERC-20 token via Permit2, doing
 * whichever of Permit2's two layers of approval are still missing:
 *  1. A plain ERC-20 approve() from the wallet to the Permit2 contract itself - a one-time,
 *     effectively unlimited (MaxUint256) approval, exactly like every other Permit2-based
 *     integration (including Uniswap's own interface) sets up, since it's Permit2's own
 *     allowance below that actually limits what any spender can move.
 *  2. Permit2's own AllowanceTransfer.approve() from the wallet to the Universal Router, with an
 *     amount and expiration - this is a plain on-chain call (not a signed EIP-712 permit), so it
 *     costs its own transaction, but only needs repeating once the expiration set here passes or
 *     a larger amount is needed than was last approved.
 * Skips whichever step's existing allowance is already sufficient, so a repeat swap of a token
 * already fully approved costs no extra transactions at all.
 */
async function ensurePermit2Allowance(
  chain: SwapChain,
  signer: ethers.Signer,
  tokenAddress: string,
  amountRaw: bigint,
): Promise<void> {
  const provider = getProvider(chain);
  const ownerAddress = await signer.getAddress();
  const routerAddress = UNIVERSAL_ROUTER[chain];

  const token = new Contract(tokenAddress, ERC20_ALLOWANCE_ABI, provider);
  const currentErc20Allowance: bigint = await token.allowance(ownerAddress, PERMIT2_ADDRESS);
  if (currentErc20Allowance < amountRaw) {
    const tokenWithSigner = token.connect(signer) as Contract;
    const gasOverrides = await getGasOverrides(chain, provider);
    const nonce = await signer.getNonce('pending');
    const tx = await tokenWithSigner.approve(PERMIT2_ADDRESS, ethers.MaxUint256, { ...gasOverrides, nonce });
    await tx.wait();
  }

  const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);
  const [permit2Allowance, expiration] = await permit2.allowance(ownerAddress, tokenAddress, routerAddress);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if ((permit2Allowance as bigint) < amountRaw || Number(expiration) < nowSeconds) {
    const permit2WithSigner = permit2.connect(signer) as Contract;
    const gasOverrides = await getGasOverrides(chain, provider);
    const nonce = await signer.getNonce('pending');
    // Permit2 allowances are stored as uint160 - clamp to that ceiling rather than reverting
    // outright in the (extreme) case amountRaw itself doesn't fit.
    const approveAmount = amountRaw > MAX_UINT160 ? MAX_UINT160 : amountRaw;
    const thirtyDays = 30 * 24 * 60 * 60;
    const tx = await permit2WithSigner.approve(tokenAddress, routerAddress, approveAmount, nowSeconds + thirtyDays, {
      ...gasOverrides,
      nonce,
    });
    await tx.wait();
  }
}

export interface SwapResult {
  hash: string;
  amountOut: string; // formatted, in tokenOut's decimals
}

/**
 * Executes a swap of `amountIn` of tokenIn for tokenOut via the Universal Router's V4_SWAP
 * command, granting the router Permit2 access first if tokenIn is an ERC-20 with insufficient
 * allowance (native-in swaps skip this entirely - the router receives native currency directly
 * via msg.value and settles it from its own balance, with no approval of any kind needed).
 * amountOutMinimum is derived from `quote` and `slippageBps` (basis points, e.g. 100 = 1%) to
 * protect against price movement between quoting and broadcast.
 *
 * A v4 swap is built as a short sequence of "actions" rather than a single function call: one
 * SWAP_EXACT_IN_SINGLE per hop, followed by one SETTLE_ALL (pay for the input) and one TAKE_ALL
 * (collect the output) - see the Actions/ACTION_* constants above. When `quote.route` is set
 * (see fetchSwapQuote), there's no direct pool for this pair, so two SWAP_EXACT_IN_SINGLE
 * actions are chained back to back instead of one: the second hop's amountIn is passed as
 * OPEN_DELTA (0), which tells V4Router to use whatever the first hop actually produced rather
 * than a fixed amount decided ahead of time. Because v4's flash accounting only nets everything
 * out at the very end, this settles in one atomic transaction exactly like V3's packed multi-hop
 * path did - the wallet never actually holds the intermediate USDT/USDC, and only the final
 * TAKE_ALL's amountOutMinimum needs to enforce the person's slippage tolerance.
 */
export async function executeSwap(
  chain: SwapChain,
  privateKey: SignerSource,
  tokenIn: SwapToken,
  tokenOut: SwapToken,
  amountIn: string,
  quote: SwapQuote,
  recipient: string,
  slippageBps: number = 100,
): Promise<SwapResult> {
  const provider = getProvider(chain);
  const signer = resolveSigner(privateKey, provider);

  // TAKE_ALL (see below) always delivers the swap's output to whoever called the Universal
  // Router - there's no separate recipient field to hand it, unlike V3's SwapRouter02. That's
  // fine since every caller in this app (SwapConfirmation) only ever passes the active wallet's
  // own address here, but this guards against that assumption silently breaking if that ever
  // changes, rather than quietly sending funds to the signer while a caller believes it went
  // somewhere else.
  const ownAddress = await signer.getAddress();
  if (recipient.toLowerCase() !== ownAddress.toLowerCase()) {
    throw new Error('executeSwap only supports swapping into the signing wallet\'s own address');
  }

  const amountInRaw = ethers.parseUnits(amountIn, tokenIn.decimals);
  const quotedOutRaw = ethers.parseUnits(quote.amountOut, tokenOut.decimals);
  const amountOutMinimum = quotedOutRaw - (quotedOutRaw * BigInt(slippageBps)) / 10000n;

  if (!tokenIn.isNative) {
    await ensurePermit2Allowance(chain, signer, tokenIn.address, amountInRaw);
  }

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const actionBytes: number[] = [];
  const paramsList: string[] = [];

  const pushSwapHop = (hopIn: string, hopOut: string, fee: number, amount: bigint) => {
    const { key, zeroForOne } = buildPoolKey(hopIn, hopOut, fee);
    actionBytes.push(ACTION_SWAP_EXACT_IN_SINGLE);
    paramsList.push(
      abiCoder.encode(
        [
          'tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)',
        ],
        [{ poolKey: key, zeroForOne, amountIn: amount, amountOutMinimum: 0n, hookData: '0x' }],
      ),
    );
  };

  if (quote.route) {
    // tokenIn -> intermediary -> tokenOut, each leg at its own fee tier - see fetchSwapQuote.
    // The intermediate leg's own amountOutMinimum is left at 0 (see pushSwapHop) since the
    // overall trade is protected end-to-end by the final TAKE_ALL below either way.
    pushSwapHop(tokenIn.address, quote.route.intermediary.address, quote.route.feeIn, amountInRaw);
    pushSwapHop(quote.route.intermediary.address, tokenOut.address, quote.route.feeOut, OPEN_DELTA);
  } else {
    pushSwapHop(tokenIn.address, tokenOut.address, quote.feeTier, amountInRaw);
  }

  actionBytes.push(ACTION_SETTLE_ALL);
  paramsList.push(abiCoder.encode(['address', 'uint256'], [tokenIn.address, amountInRaw]));

  actionBytes.push(ACTION_TAKE_ALL);
  paramsList.push(abiCoder.encode(['address', 'uint256'], [tokenOut.address, amountOutMinimum]));

  const actions = ethers.solidityPacked(
    actionBytes.map(() => 'uint8'),
    actionBytes,
  );
  const v4SwapInput = abiCoder.encode(['bytes', 'bytes[]'], [actions, paramsList]);
  const commands = ethers.solidityPacked(['uint8'], [CMD_V4_SWAP]);

  const routerAddress = UNIVERSAL_ROUTER[chain];
  const router = new Contract(routerAddress, UNIVERSAL_ROUTER_ABI, signer);
  const gasOverrides = await getGasOverrides(chain, provider);
  const nonce = await signer.getNonce('pending');
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60; // 20 minutes
  const txOverrides = { ...gasOverrides, nonce, value: tokenIn.isNative ? amountInRaw : 0n };

  const tx = await router.execute(commands, [v4SwapInput], deadline, txOverrides);
  const receipt = await tx.wait();

  return { hash: (receipt && receipt.hash) || tx.hash, amountOut: quote.amountOut };
}

/**
 * User-facing classification of a failed swap, for SwapConfirmation's catch block - same
 * idea as parseSendError in lib/chains.ts, but for the failure shapes specific to a Uniswap
 * v4 swap (as opposed to a plain transfer).
 */
export type SwapErrorKind =
  | 'too_little_received' // amountOutMinimum not met - price moved or slippage too tight
  | 'insufficient_funds' // not enough native balance to cover amount (+gas)
  | 'allowance_or_transfer' // Permit2/ERC20 approve or transfer step failed
  | 'stale_quote_or_liquidity' // empty revert data - typically a stale quote or a pool that
  // can no longer fill this exact trade (very small trade sizes
  // are especially prone to this - see rawMessage/kind docs)
  | 'unknown';

export interface ParsedSwapError {
  kind: SwapErrorKind;
  rawMessage: string;
}

/**
 * Turns a raw ethers/RPC swap error into one of a small set of plain-language cases the UI
 * can render (see swap.error_detail_* in i18n/messages.json), instead of surfacing ethers'
 * jargon-heavy CALL_EXCEPTION text directly to the person.
 *
 * The 'stale_quote_or_liquidity' case (empty revert data, i.e. a require()/custom-error revert
 * with no decodable message) deliberately doesn't claim to know the exact cause - it can be the
 * pool's price moving between quoting and broadcast, or v4's tick math hitting a degenerate case
 * on a very small trade amount (rounding after the pool fee can leave too little to price
 * correctly) - both produce the exact same empty-revert shape from the node's perspective.
 */
export function parseSwapError(error: unknown): ParsedSwapError {
  const rawMessage = extractRpcMessage(error);
  const lower = rawMessage.toLowerCase();

  if (lower.includes('too little received') || lower.includes('v4toolittlereceived')) {
    return { kind: 'too_little_received', rawMessage };
  }

  const looksInsufficientFunds =
    lower.includes('insufficient funds') || (error as { code?: string } | null)?.code === 'INSUFFICIENT_FUNDS';
  if (looksInsufficientFunds) {
    return { kind: 'insufficient_funds', rawMessage };
  }

  if (
    lower.includes('transferfrom') ||
    lower.includes('allowance') ||
    lower.includes('permit2') ||
    lower === 'stf' ||
    lower.includes("'stf'")
  ) {
    return { kind: 'allowance_or_transfer', rawMessage };
  }

  // No parsable reason string at all (or ethers' own "no data present" wrapper text) -
  // this is the empty-revert-data shape described above.
  if (!rawMessage || rawMessage === '0x' || lower.includes('no data present')) {
    return { kind: 'stale_quote_or_liquidity', rawMessage };
  }

  return { kind: 'unknown', rawMessage };
}

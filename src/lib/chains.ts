import { ethers } from 'ethers';
import { resolveSigner } from './signer';
import type { SignerSource } from './signer';
import { loadScanCache, saveScanCache } from './scanCache';

/**
 * Supported EVM chains. Ethereum, Polygon and Kaia are all EVM-compatible, so the same
 * address/private key (see lib/mnemonic.ts) works on every one of them — only the RPC
 * endpoint, chainId and per-chain contract addresses below change.
 *
 * Uses ethers v6.
 */
export type ChainKey = 'ethereum' | 'polygon' | 'kaia' | 'avalanche';

// 'mainnet' is the normal, real-value mode. 'debug' swaps every chain in CHAINS (and
// TOKEN_LISTS) for its testnet counterpart, so nothing in mainnet mode is reachable while
// debug mode is active - the two are mutually exclusive, not additive.
export type NetworkMode = 'mainnet' | 'debug';

export interface ChainConfig {
  key: ChainKey;
  name: string;
  chainId: number;
  // Ordered list of JSON-RPC endpoints for this chain. Public RPC nodes are shared,
  // unauthenticated infrastructure that go down or get deprecated without much notice
  // (e.g. Polygon shut off its old Amoy endpoint on 2026-07-17), so every chain gets at
  // least one fallback. Balance reads try these in order via withRpcFallback() below, so
  // a single dead endpoint doesn't read back as a zero balance.
  rpcUrls: string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  // Official JPYC (資金移動業JPYC) contract address on this chain.
  // Source: https://github.com/jpycoin (same address across Ethereum/Polygon/Avalanche/Kaia).
  jpycAddress: string;
  blockExplorerUrl: string;
  // CoinGecko coin id for this chain's native currency, used to convert the native
  // balance into JPY for the Home screen's total-assets figure.
  coingeckoId: string;
}

const MAINNET_CHAINS: Record<ChainKey, ChainConfig> = {
  ethereum: {
    key: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    // rpc.ankr.com/eth was dropped for requiring an API key even for plain reads. Two more
    // rounds of live testing then showed eth.merkle.io (CORS preflight rate-limited to 429)
    // and cloudflare-eth.com ("Cannot fulfill request" on even eth_blockNumber) failing on
    // ordinary, non-log calls too, so both were dropped in turn - publicnode, 1rpc and drpc
    // are the ones that actually answer basic reads right now.
    rpcUrls: [
      'https://ethereum-rpc.publicnode.com',
      'https://eth.llamarpc.com',
      'https://1rpc.io/eth',
      'https://eth.drpc.org',
    ],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    jpycAddress: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29',
    blockExplorerUrl: 'https://etherscan.io',
    coingeckoId: 'ethereum',
  },
  polygon: {
    key: 'polygon',
    name: 'Polygon',
    chainId: 137,
    // polygon-rpc.com started returning 401 "API key disabled" (it now proxies to a paid
    // backend), same story as ankr - dropped for the same reason as ethereum above.
    rpcUrls: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon.llamarpc.com',
      'https://1rpc.io/matic',
      'https://polygon.drpc.org',
    ],
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    jpycAddress: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29',
    blockExplorerUrl: 'https://polygonscan.com',
    coingeckoId: 'polygon-ecosystem-token',
  },
  avalanche: {
    key: 'avalanche',
    name: 'Avalanche',
    chainId: 43114,
    // api.avax.network is Ava Labs' own public endpoint; the other three are the same
    // publicnode/1rpc/drpc providers already relied on for the other chains above.
    rpcUrls: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://avalanche-c-chain-rpc.publicnode.com',
      'https://1rpc.io/avax/c',
      'https://avalanche.drpc.org',
    ],
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    jpycAddress: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29',
    blockExplorerUrl: 'https://snowtrace.io',
    coingeckoId: 'avalanche-2',
  },
  kaia: {
    key: 'kaia',
    name: 'Kaia',
    chainId: 8217,
    rpcUrls: ['https://public-en.node.kaia.io', 'https://kaia.drpc.org'],
    nativeCurrency: { name: 'Kaia', symbol: 'KAIA', decimals: 18 },
    jpycAddress: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29',
    blockExplorerUrl: 'https://kaiascan.io',
    coingeckoId: 'kaia',
  },
};

// Debug-mode counterparts. Same JPYC contract address as mainnet - JPYC is deployed at the
// identical address on Sepolia/Amoy/Kairos - only chainId/RPC/explorer differ per network.
const TESTNET_CHAINS: Record<ChainKey, ChainConfig> = {
  ethereum: {
    key: 'ethereum',
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    // rpc.ankr.com/eth_sepolia dropped - ankr's public endpoints now require an API key
    // even for basic reads, same issue as the mainnet ethereum entry above.
    rpcUrls: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://sepolia.drpc.org',
      'https://rpc.sepolia.org',
    ],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    jpycAddress: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29',
    blockExplorerUrl: 'https://sepolia.etherscan.io',
    coingeckoId: 'ethereum',
  },
  polygon: {
    key: 'polygon',
    name: 'Polygon Amoy',
    chainId: 80002,
    // Polygon deprecated and shut off the old rpc-amoy.polygon.technology public endpoint
    // on 2026-07-17 - it no longer responds at all, which is why Amoy balances stopped
    // showing up. Replaced with currently-live public endpoints, primary first.
    // rpc.ankr.com/polygon_amoy dropped - same ankr API-key issue as elsewhere in this file.
    rpcUrls: [
      'https://polygon-amoy-bor-rpc.publicnode.com',
      'https://polygon-amoy.drpc.org',
      'https://rpc-amoy.polygon.technology',
    ],
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    jpycAddress: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29',
    blockExplorerUrl: 'https://amoy.polygonscan.com',
    coingeckoId: 'polygon-ecosystem-token',
  },
  avalanche: {
    key: 'avalanche',
    name: 'Avalanche Fuji',
    chainId: 43113,
    rpcUrls: [
      'https://api.avax-test.network/ext/bc/C/rpc',
      'https://avalanche-fuji-c-chain.publicnode.com',
    ],
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    jpycAddress: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29',
    blockExplorerUrl: 'https://testnet.snowtrace.io',
    coingeckoId: 'avalanche-2',
  },
  kaia: {
    key: 'kaia',
    name: 'Kaia Kairos',
    chainId: 1001,
    rpcUrls: [
      'https://public-en-kairos.node.kaia.io',
      'https://kaia-kairos.drpc.org',
    ],
    nativeCurrency: { name: 'Kaia', symbol: 'KAIA', decimals: 18 },
    jpycAddress: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29',
    blockExplorerUrl: 'https://kairos.kaiascan.io',
    coingeckoId: 'kaia',
  },
};

let currentNetworkMode: NetworkMode = 'mainnet';

export function getNetworkMode(): NetworkMode {
  return currentNetworkMode;
}

// Switches every chain lookup (CHAINS, TOKEN_LISTS) between mainnet and debug configs.
// Called from appStore's setNetworkMode action, which is the single source of truth for
// persistence - this function only updates chains.ts's own live state and invalidates the
// provider/rate caches (a cached mainnet provider must never serve a debug-mode call).
export function setNetworkMode(mode: NetworkMode) {
  if (currentNetworkMode === mode) return;
  currentNetworkMode = mode;
  providerCache.clear();
  jpyRateCache.clear();
}

// A live view over whichever chain set is currently active. Every consumer reads through
// this Proxy (CHAINS[key], Object.keys(CHAINS)) rather than capturing MAINNET_CHAINS /
// TESTNET_CHAINS directly, so a mode switch takes effect everywhere without needing every
// call site to resubscribe to anything.
function createLiveRecord<T>(mainnet: Record<ChainKey, T>, testnet: Record<ChainKey, T>): Record<ChainKey, T> {
  return new Proxy({} as Record<ChainKey, T>, {
    get: (_target, prop) => (currentNetworkMode === 'debug' ? testnet : mainnet)[prop as ChainKey],
    ownKeys: () => Reflect.ownKeys(mainnet),
    getOwnPropertyDescriptor: (_target, prop) => Reflect.getOwnPropertyDescriptor(mainnet, prop),
  });
}

export const CHAINS: Record<ChainKey, ChainConfig> = createLiveRecord(MAINNET_CHAINS, TESTNET_CHAINS);

export const DEFAULT_CHAIN: ChainKey = 'ethereum';

const EVM_CHAIN_KEYS: readonly ChainKey[] = ['ethereum', 'polygon', 'kaia', 'avalanche'];

/** True if `id` is one of this app's curated EVM chains (as opposed to a CustomChainRecord
 * id, as used by TransactionWrapper.chain). */
export function isEvmChainKey(id: string): id is ChainKey {
  return (EVM_CHAIN_KEYS as readonly string[]).includes(id);
}

// Minimal ERC-20 ABI: only what the wallet needs (balance, decimals, transfer, and the
// Transfer event for history/confirmation screens).
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

// One plain JsonRpcProvider per RPC URL, keyed by chain+url so repeated calls reuse the
// same instance instead of reconnecting every time.
const providerCache = new Map<string, ethers.JsonRpcProvider>();

function providerFor(chain: ChainKey, url: string): ethers.JsonRpcProvider {
  const cacheKey = `${chain}:${url}`;
  let provider = providerCache.get(cacheKey);
  if (!provider) {
    const config = CHAINS[chain];
    // Passing {name, chainId} explicitly marks this as a "static network" provider, so
    // ethers trusts it immediately instead of issuing its own eth_chainId probe first.
    // batchMaxCount: 1 turns off ethers' default JSON-RPC batching (multiple calls folded
    // into one HTTP POST carrying a JSON array). Several free providers in this app's
    // fallback list reject or mishandle batched requests outright - drpc refuses batches
    // over 3 on its free plan, and other batch-shaped requests were seen coming back as a
    // single opaque error covering every call in the batch instead of failing individually.
    // Sending one call per HTTP request is slightly chattier but works uniformly everywhere.
    provider = new ethers.JsonRpcProvider(
      url,
      { name: config.name, chainId: config.chainId },
      { staticNetwork: true, batchMaxCount: 1 },
    );
    providerCache.set(cacheKey, provider);
  }
  return provider;
}

// Returns a provider for this chain's primary (first-listed) RPC URL. Used for anything
// that needs a single stable provider instance (contract instantiation, sending
// transactions) where automatic fallback isn't attempted - retrying a broadcast against a
// second node risks confusing nonce/duplicate-tx handling, so writes intentionally don't
// get the same fallback treatment as the read helpers below.
export function getProvider(chain: ChainKey): ethers.JsonRpcProvider {
  return providerFor(chain, CHAINS[chain].rpcUrls[0]);
}

// Tries every configured RPC URL for this chain, in order, until one of them completes
// the given call successfully. Deliberately avoids ethers' FallbackProvider: in this app
// it produced "could not detect network" (event=noNetwork) failures wholesale (even on
// otherwise-healthy chains) instead of the graceful per-endpoint fallback it promises, so
// this does the same job with a plain sequential try/catch that's easy to reason about.
// A single dead/deprecated endpoint (like Amoy's old public RPC) is skipped in favor of
// the next one rather than failing the whole read.
export async function withRpcFallback<T>(chain: ChainKey, call: (provider: ethers.JsonRpcProvider) => Promise<T>): Promise<T> {
  const urls = CHAINS[chain].rpcUrls;
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await call(providerFor(chain, url));
    } catch (error) {
      lastError = error;
      console.warn(`RPC call failed on ${chain} via ${url}, trying next endpoint`, error);
    }
  }
  throw lastError;
}

export function getJpycContract(chain: ChainKey) {
  return new ethers.Contract(CHAINS[chain].jpycAddress, ERC20_ABI, getProvider(chain));
}

export interface Balances {
  native: string;   // formatted, e.g. "0.1234"
  jpyc: string;      // formatted, e.g. "10000.0"
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  // Logo URL from CoinGecko's contract-lookup endpoint (see fetchTokenIconUrl below),
  // captured once when a custom token is added via fetchTokenMetadata. undefined for
  // curated TOKEN_LISTS entries (those use lib/tokenIcons.ts's bundled icons instead) and
  // for any custom token CoinGecko doesn't have listed - callers fall back to the chain
  // icon in that case, same as before this field existed.
  iconUrl?: string;
  // Photo the person picked by hand at add-time (data: URL) - only ever set for tokens
  // registered on a custom EVM chain (see storage.ts's CustomTokenRecord), where CoinGecko
  // usually has nothing. Takes priority over iconUrl when both are present.
  iconDataUrl?: string;
}

export interface TokenBalance extends TokenInfo {
  balance: string; // formatted
}

// A curated list of well-known ERC-20 tokens per chain. There is no way to ask a plain
// RPC node "list every token this address holds" — that requires a paid indexing API
// (Etherscan/Alchemy/Moralis/etc). Checking balanceOf() against a known-token list is the
// standard zero-backend approach lightweight wallets use instead: it surfaces mainstream
// tokens (and hides ones the person actually never held, since we filter to balance > 0),
// but an obscure/newly-airdropped token not on this list won't show up.
const MAINNET_TOKEN_LISTS: Record<ChainKey, TokenInfo[]> = {
  ethereum: [
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', name: 'Chainlink', decimals: 18 },
    { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI', name: 'Uniswap', decimals: 18 },
  ],
  polygon: [
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
    { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { address: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', symbol: 'LINK', name: 'Chainlink', decimals: 18 },
  ],
  kaia: [
    { address: '0xceE8FAF64bB97a73bb51E115Aa89C17FfA8dD167', symbol: 'USDT', name: 'Tether USD (Kaia)', decimals: 6 },
    { address: '0x754288077D0fF82AF7a5317C7CB8c444D421d103', symbol: 'USDC', name: 'USD Coin (Kaia)', decimals: 6 },
    { address: '0x19Aac5f612f524B754CA7e7c41cbFa2E981A4432', symbol: 'WKLAY', name: 'Wrapped Kaia', decimals: 18 },
  ],
  avalanche: [
    { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { address: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', symbol: 'DAI.e', name: 'Dai Stablecoin (Avalanche Bridge)', decimals: 18 },
    { address: '0x50b7545627a5162F82A992c33b87aDc75187B218', symbol: 'WBTC.e', name: 'Wrapped BTC (Avalanche Bridge)', decimals: 8 },
    { address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', symbol: 'WETH.e', name: 'Wrapped Ether (Avalanche Bridge)', decimals: 18 },
    { address: '0x5947BB275c521040051D82396192181b413227A3', symbol: 'LINK.e', name: 'Chainlink (Avalanche Bridge)', decimals: 18 },
  ],
};

// No curated token list for testnets: unlike JPYC, these mainnet stablecoin/wrapped-token
// addresses are not guaranteed to exist (or hold the same meaning) on Sepolia/Amoy/Kairos,
// so debug mode only surfaces JPYC + the native coin rather than risk pointing at the
// wrong contract.
const TESTNET_TOKEN_LISTS: Record<ChainKey, TokenInfo[]> = {
  ethereum: [],
  polygon: [],
  kaia: [],
  avalanche: [],
};

export const TOKEN_LISTS: Record<ChainKey, TokenInfo[]> = createLiveRecord(MAINNET_TOKEN_LISTS, TESTNET_TOKEN_LISTS);

// Simple in-memory cache so switching tabs / re-rendering Home doesn't refetch the price
// on every call within the same session.
const jpyRateCache = new Map<ChainKey, number>();

/**
 * Fetches the current JPY price of the given chain's native currency from CoinGecko.
 * Returns 0 (rather than throwing) on failure, so a rate outage degrades the total-assets
 * figure gracefully instead of breaking the Home screen.
 */
export async function fetchNativeJpyRate(chain: ChainKey): Promise<number> {
  const cached = jpyRateCache.get(chain);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const id = CHAINS[chain].coingeckoId;
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=jpy`);
    const json = await response.json();
    const rate = Number(json?.[id]?.jpy ?? 0);
    jpyRateCache.set(chain, rate);
    return rate;
  } catch (e) {
    console.error('Failed to fetch JPY rate', e);
    return 0;
  }
}

/**
 * Fetches the current JPY price of every given chain's native currency from CoinGecko in
 * a single batched request (one comma-separated `ids` list), rather than one request per
 * chain - used by the Home screen's Token card, which shows all four native-coin prices
 * at once. Falls back to 0 for any chain CoinGecko didn't return a price for.
 */
export async function fetchNativeJpyRates(chains: ChainKey[]): Promise<Record<ChainKey, number>> {
  const result = {} as Record<ChainKey, number>;
  const uncached = chains.filter((chain) => jpyRateCache.get(chain) === undefined);
  for (const chain of chains) {
    const cached = jpyRateCache.get(chain);
    if (cached !== undefined) {
      result[chain] = cached;
    }
  }
  if (uncached.length === 0) {
    return result;
  }
  try {
    const ids = uncached.map((chain) => CHAINS[chain].coingeckoId);
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=jpy`);
    const json = await response.json();
    for (const chain of uncached) {
      const id = CHAINS[chain].coingeckoId;
      const rate = Number(json?.[id]?.jpy ?? 0);
      jpyRateCache.set(chain, rate);
      result[chain] = rate;
    }
  } catch (e) {
    console.error('Failed to fetch JPY rates', e);
    for (const chain of uncached) {
      result[chain] = result[chain] ?? 0;
    }
  }
  return result;
}


// CoinGecko coin ids for the curated tokens in TOKEN_LISTS above, keyed by symbol (the
// same stablecoin/wrapped-token trades at the same USD-equivalent price regardless of
// which of our four chains it's held on, so one symbol->id map covers all of them - no
// need to key this by chain the way the native-coin map above is). Used to price the
// Balance screen's total-assets figure. A token whose symbol isn't listed here (custom
// tokens the person registered by hand, or a curated token CoinGecko doesn't index) is
// simply left out of that total rather than guessed at.
const TOKEN_COINGECKO_IDS: Record<string, string> = {
  USDT: 'tether',
  USDC: 'usd-coin',
  DAI: 'dai',
  'DAI.e': 'dai',
  WBTC: 'wrapped-bitcoin',
  'WBTC.e': 'wrapped-bitcoin',
  WETH: 'weth',
  'WETH.e': 'weth',
  LINK: 'chainlink',
  'LINK.e': 'chainlink',
  UNI: 'uniswap',
  WKLAY: 'wrapped-klay',
};

// Simple in-memory cache, same idea as jpyRateCache above but keyed by CoinGecko coin id
// rather than chain, since a token's price doesn't depend on which chain it's held on.
const tokenJpyRateCache = new Map<string, number>();

/**
 * Fetches the current JPY price of every given token symbol from CoinGecko, in a single
 * batched request, for symbols this app knows a CoinGecko id for (see
 * TOKEN_COINGECKO_IDS). Symbols with no known id (custom tokens, mainly) are silently
 * left out of the result rather than priced at 0 - the caller should treat a missing key
 * as "no reliable price", not "worth nothing". Returns {} (rather than throwing) on a
 * request failure, so a rate outage degrades the total-assets figure gracefully instead
 * of breaking the Balance screen.
 */
export async function fetchTokenJpyRates(symbols: string[]): Promise<Record<string, number>> {
  const ids = Array.from(new Set(
    symbols.map((s) => TOKEN_COINGECKO_IDS[s]).filter((id): id is string => id !== undefined),
  ));
  const result: Record<string, number> = {};
  const uncached = ids.filter((id) => tokenJpyRateCache.get(id) === undefined);
  for (const id of ids) {
    const cached = tokenJpyRateCache.get(id);
    if (cached !== undefined) {
      result[id] = cached;
    }
  }
  if (uncached.length > 0) {
    try {
      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${uncached.join(',')}&vs_currencies=jpy`);
      const json = await response.json();
      for (const id of uncached) {
        const rate = Number(json?.[id]?.jpy ?? 0);
        tokenJpyRateCache.set(id, rate);
        result[id] = rate;
      }
    } catch (e) {
      console.error('Failed to fetch token JPY rates', e);
    }
  }
  // Map back from coingecko id to symbol, since that's what callers actually key their
  // token balances by.
  const bySymbol: Record<string, number> = {};
  for (const symbol of symbols) {
    const id = TOKEN_COINGECKO_IDS[symbol];
    if (id !== undefined && result[id] !== undefined) {
      bySymbol[symbol] = result[id];
    }
  }
  return bySymbol;
}

/**
 * Fetches the native-coin and JPYC balances for an address on the given chain.
 */
export async function fetchBalances(chain: ChainKey, address: string): Promise<Balances> {
  // Native and JPYC are fetched independently (not as a single Promise.all) because JPYC
  // has no contract at this address on every network - e.g. it isn't deployed on Polygon
  // Amoy - so calling balanceOf()/decimals() there reverts. A reverting JPYC call must not
  // take down the native balance too, since that one is always reachable via plain RPC.
  // Each side also gets its own RPC-endpoint fallback (see withRpcFallback) so a single
  // dead/unreachable node doesn't read back as a zero balance.
  const [nativeResult, jpycResult] = await Promise.allSettled([
    withRpcFallback(chain, (provider) => provider.getBalance(address)),
    withRpcFallback(chain, async (provider) => {
      const jpyc = new ethers.Contract(CHAINS[chain].jpycAddress, ERC20_ABI, provider);
      const [jpycRaw, jpycDecimals] = await Promise.all([
        jpyc.balanceOf(address) as Promise<bigint>,
        jpyc.decimals() as Promise<bigint>,
      ]);
      return ethers.formatUnits(jpycRaw, jpycDecimals);
    }),
  ]);

  if (nativeResult.status === 'rejected') {
    console.error(`Failed to fetch native balance on ${chain}`, nativeResult.reason);
  }
  if (jpycResult.status === 'rejected') {
    console.error(`Failed to fetch JPYC balance on ${chain} (JPYC may not be deployed here)`, jpycResult.reason);
  }

  return {
    native: nativeResult.status === 'fulfilled'
      ? ethers.formatUnits(nativeResult.value, CHAINS[chain].nativeCurrency.decimals)
      : '0',
    jpyc: jpycResult.status === 'fulfilled' ? jpycResult.value : '0',
  };
}

/**
 * Total portfolio value across every supported chain, converted to JPY: JPYC (JPY-pegged
 * 1:1, added as-is) plus each chain's native coin (ETH/POL/KAIA/AVAX, via
 * fetchNativeJpyRate) plus any held curated ERC-20 token this app has a CoinGecko id for
 * (USDT, USDC, and anything else in TOKEN_COINGECKO_IDS, via fetchTokenJpyRates).
 * Tokens the person registered by hand (see CustomTokensHelper) are intentionally left
 * out - there's no reliable price feed for an arbitrary contract address, so passing no
 * custom-tokens list to fetchTokenBalances here naturally excludes them. Used by the Home
 * screen's Balance card total-assets toggle.
 */
export async function fetchTotalAssetsJpy(address: string): Promise<number> {
  const chainKeys = Object.keys(CHAINS) as ChainKey[];
  const perChain = await Promise.all(chainKeys.map(async (key) => {
    const [balances, jpyRate, tokens] = await Promise.all([
      fetchBalances(key, address),
      fetchNativeJpyRate(key),
      fetchTokenBalances(key, address),
    ]);
    return { balances, jpyRate, tokens };
  }));

  const heldSymbols = perChain.flatMap((c) => c.tokens.filter((t) => Number(t.balance) > 0).map((t) => t.symbol));
  const tokenRates = await fetchTokenJpyRates(heldSymbols);

  return perChain.reduce((sum, c) => {
    let chainTotal = Number(c.balances.jpyc || 0) + Number(c.balances.native || 0) * c.jpyRate;
    for (const token of c.tokens) {
      const rate = tokenRates[token.symbol];
      if (rate) chainTotal += Number(token.balance || 0) * rate;
    }
    return sum + chainTotal;
  }, 0);
}

/**
 * Checks balanceOf() for every token on this chain's curated list, plus any
 * caller-supplied custom tokens (e.g. ones the person added by contract address - see
 * fetchTokenMetadata), and returns the ones worth showing. Decimals for curated tokens are
 * taken from the list (not fetched on-chain) to avoid doubling the number of RPC calls
 * against a public node; custom tokens already carry their decimals from when they were
 * added.
 */
export async function fetchTokenBalances(chain: ChainKey, address: string, customTokens: TokenInfo[] = []): Promise<TokenBalance[]> {
  const known = TOKEN_LISTS[chain];
  // A custom token that happens to duplicate a curated one is just the curated entry -
  // no need to fetch it twice.
  const knownAddresses = new Set(known.map((t) => t.address.toLowerCase()));
  const customOnly = customTokens.filter((t) => !knownAddresses.has(t.address.toLowerCase()));

  const fetchOne = async (token: TokenInfo): Promise<TokenBalance | null> => {
    try {
      const raw = await withRpcFallback(chain, (provider) => {
        const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
        return contract.balanceOf(address) as Promise<bigint>;
      });
      return { ...token, balance: ethers.formatUnits(raw, token.decimals) };
    } catch (e) {
      // A single bad/unreachable token contract shouldn't take down the whole list.
      console.error(`Failed to fetch balance for token ${token.symbol} on ${chain}`, e);
      return null;
    }
  };

  const [knownResults, customResults] = await Promise.all([
    Promise.all(known.map(fetchOne)),
    Promise.all(customOnly.map(fetchOne)),
  ]);

  // Curated/mainstream tokens are hidden when the balance is zero, to keep the list from
  // being cluttered with tokens the wallet never actually held. Custom tokens the person
  // explicitly added are always shown, even at zero - that's the point of adding them, and
  // a zero balance there still confirms the address was entered correctly.
  const knownNonZero = knownResults.filter((t): t is TokenBalance => t !== null && Number(t.balance) !== 0);
  const customShown = customResults.filter((t): t is TokenBalance => t !== null);

  return [...knownNonZero, ...customShown];
}

// CoinGecko "asset platform" id for each chain, used by fetchTokenIconUrl below. This is a
// different id namespace from ChainConfig.coingeckoId above (that one identifies the chain's
// *native coin*, e.g. Polygon's is 'polygon-ecosystem-token' - this one identifies the chain
// itself for the /coins/{platform}/contract/{address} lookup, e.g. 'polygon-pos'). Kaia's
// platform id after the Klaytn->Kaia merge isn't independently confirmed as of writing, so it
// lists both the current guess and the pre-merge id ('klay-token') as fallbacks - a wrong or
// stale id here just makes every request 404, which fetchTokenIconUrl already treats as
// "no icon available" rather than an error.
const COINGECKO_PLATFORM_IDS: Record<ChainKey, string[]> = {
  ethereum: ['ethereum'],
  polygon: ['polygon-pos'],
  avalanche: ['avalanche'],
  kaia: ['kaia', 'klay-token'],
};

// How long to wait on CoinGecko before giving up on an icon for this token. Icon lookup is
// a nice-to-have, not something the "add token" flow should ever hang on.
const COINGECKO_ICON_TIMEOUT_MS = 5000;

/**
 * Best-effort lookup of a token's logo via CoinGecko's free, keyless contract-lookup
 * endpoint, for showing a real icon on tokens registered through the "add custom token"
 * dialog (lib/tokenIcons.ts's curated set only covers USDT/USDC/JPYC). Called once, at
 * add-time, in fetchTokenMetadata below - not on every balance refresh - so this doesn't
 * run into the rate-limit trouble the old per-refresh JPY/USD price fetch hit (see the
 * comment in pages/detail/Balance.tsx's fetchAll). Never throws: any failure (token not
 * listed on CoinGecko, rate limit, network error) resolves to null so a missing icon never
 * blocks adding the token - the caller falls back to the chain icon, same as before this
 * existed.
 */
async function fetchTokenIconUrl(chain: ChainKey, address: string): Promise<string | null> {
  for (const platformId of COINGECKO_PLATFORM_IDS[chain]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), COINGECKO_ICON_TIMEOUT_MS);
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${platformId}/contract/${address}`,
        { signal: controller.signal },
      );
      clearTimeout(timer);
      if (!res.ok) continue; // 404 (unlisted token / wrong platform id) or rate-limited - try next id, if any
      const data = await res.json();
      const url: string | undefined = data?.image?.small || data?.image?.thumb;
      // CoinGecko returns its generic "missing image" placeholder (rather than a 404) for
      // some unlisted tokens - skip that so it never gets shown as if it were the real logo.
      if (url && !url.includes('missing_large')) return url;
    } catch {
      // Network error, timeout, or CORS issue - fall through to the next platform id.
    }
  }
  return null;
}

/**
 * Reads symbol/decimals/name directly from an ERC-20 contract at the given address, for the
 * "add custom token" flow where the person supplies a chain + contract address that isn't on
 * the curated list. Throws if the address is malformed or doesn't behave like an ERC-20 (no
 * symbol()/decimals()), so the caller can show a clear error instead of a broken entry.
 */
export async function fetchTokenMetadata(chain: ChainKey, address: string): Promise<TokenInfo> {
  if (!ethers.isAddress(address)) {
    throw new Error('invalid_address');
  }
  const checksummed = ethers.getAddress(address);
  const contract = new ethers.Contract(checksummed, ERC20_ABI, getProvider(chain));
  const [symbol, decimals, iconUrl] = await Promise.all([
    contract.symbol() as Promise<string>,
    contract.decimals() as Promise<bigint>,
    fetchTokenIconUrl(chain, checksummed),
  ]);
  // name() is optional per the ERC-20 standard proper - some deployed tokens omit it despite
  // implementing everything else, so a failure here falls back to the symbol rather than
  // aborting the whole lookup.
  let name = symbol;
  try {
    name = await (contract.name() as Promise<string>);
  } catch {
    // Fall back to symbol, set above.
  }
  return { address: checksummed, symbol, name, decimals: Number(decimals), iconUrl: iconUrl ?? undefined };
}

// --- Transaction history (no paid indexer/explorer API) -------------------------------
//
// There is no way to ask a plain public RPC node "list every transfer this address was
// ever involved in" - that is exactly what paid indexer/explorer APIs (Etherscan Pro,
// Alchemy, Moralis, Covalent, ...) are for. What a plain RPC node *does* support for free
// is eth_getLogs, which can return every emitted `Transfer(address,address,uint256)` event
// for a given contract within a block range. That's enough to reconstruct JPYC transfer
// history (send + receive) without any paid service - it just can't see plain native-coin
// (ETH/POL/KAIA) sends, since those don't emit a log at all. This trade-off is deliberate:
// the app's primary currency is JPYC, so JPYC history covers the transactions people
// actually care about on the Home screen.

const TRANSFER_EVENT_TOPIC = ethers.id('Transfer(address,address,uint256)');

// Free public RPC nodes commonly reject an eth_getLogs call whose block range is too wide.
// Live testing in mid/late-2026 found this getting steadily worse: publicnode now rejects
// many eth_getLogs calls outright as "archive" requests, drpc caps free-plan ranges at
// 10000 blocks but also refuses to batch more than 3 requests together, and 1rpc.io - the
// most restrictive of the three, but the only one with a clearly documented, actually
// enforced limit - caps every call to a 50-block range. 50 was chosen so the scan can
// still complete successfully on whichever endpoint answers, instead of guessing a larger
// number that happens to work today and breaks again next time a provider tightens its cap.
const LOG_CHUNK_BLOCKS = 50;
// Caps total RPC calls per chain when a wallet has little or no JPYC history, rather than
// walking all the way back to the contract's genesis block on every Home screen load.
// Raised sharply alongside the much smaller LOG_CHUNK_BLOCKS above (50*40 = 2000 blocks)
// since a single chunk now covers far fewer blocks than before; this is a real trade-off -
// free public nodes no longer support scanning enough history to reliably find JPYC
// transfers or NFTs beyond a fairly recent window.
const LOG_MAX_CHUNKS = 40;
// How many LOG_CHUNK_BLOCKS windows are fetched concurrently within one walkChunkedRange
// batch. Chunks are independent (each is its own fromBlock/toBlock range), so there's no
// reason to wait for one window to finish before requesting the next - the previous
// strictly-sequential version turned a 40-chunk scan into 40 sequential round trips, which
// was the single biggest contributor to slow transaction/NFT loading. 5 was chosen as a
// balance: high enough to cut round trips ~5x, low enough that a burst of 5 concurrent
// requests stays under the batch caps some free RPC providers enforce (see the drpc note
// above LOG_CHUNK_BLOCKS).
const CHUNK_PARALLELISM = 5;

/**
 * Splits [fromBlock, toBlock] into LOG_CHUNK_BLOCKS-sized windows (newest-first) and fetches
 * them CHUNK_PARALLELISM-at-a-time via `fetchChunk`, stopping once `stopEarly` says enough
 * has been found or `maxWindows` windows have been processed. Used both for the historical
 * backward walk and the incremental forward catch-up scan below - every public RPC's
 * block-range cap applies regardless of which direction is being walked, so both need the
 * same chunking/parallel-batching. Returns the block that the walk actually reached (its
 * caller uses this to know how much of history is now covered).
 */
export async function walkChunkedRange<T>(
  fromBlock: number,
  toBlock: number,
  fetchChunk: (fromBlock: number, toBlock: number) => Promise<T[]>,
  stopEarly: ((resultsSoFar: T[]) => boolean) | undefined,
  maxWindows: number,
): Promise<{ items: T[]; coveredFromBlock: number }> {
  if (fromBlock > toBlock) return { items: [], coveredFromBlock: toBlock + 1 };

  const items: T[] = [];
  let coveredFromBlock = toBlock + 1;
  let windowCount = 0;
  let end = toBlock;

  while (end >= fromBlock && windowCount < maxWindows) {
    const batchWindows: { fromBlock: number; toBlock: number }[] = [];
    for (let i = 0; i < CHUNK_PARALLELISM && end >= fromBlock && windowCount < maxWindows; i++) {
      const start = Math.max(end - LOG_CHUNK_BLOCKS + 1, fromBlock);
      batchWindows.push({ fromBlock: start, toBlock: end });
      windowCount++;
      end = start - 1;
    }

    const batchResults = await Promise.all(batchWindows.map((w) => fetchChunk(w.fromBlock, w.toBlock)));
    for (const r of batchResults) items.push(...r);
    coveredFromBlock = batchWindows[batchWindows.length - 1].fromBlock;

    if (stopEarly && stopEarly(items)) break;
  }

  return { items, coveredFromBlock };
}

// Cap on how many raw log entries the persistent cache keeps per wallet+chain+token. Bounds
// storage size while comfortably covering every caller (Home wants 10, TransactionList wants
// up to 100).
const CACHE_ITEM_CAP = 200;

interface RawTransferLog {
  // A ChainKey for curated chains, or a CustomChainRecord id (e.g. "custom-42161") for a
  // hand-added network - kept as a plain string (rather than ChainKey) so this same scanning
  // machinery works for both without CHAINS needing an entry for every possible network.
  chain: string;
  hash: string;
  logIndex: number;
  blockNumber: number;
  isReception: boolean;
  senderAddress: string;
  receiverAddress: string;
  amountRaw: bigint;
}

function transferLogKey(log: RawTransferLog): string {
  return `${log.blockNumber}:${log.logIndex}`;
}

async function fetchTransferLogsInRange(
  provider: ethers.JsonRpcProvider,
  chain: string,
  tokenAddress: string,
  walletAddress: string,
  paddedAddress: string,
  fromBlock: number,
  toBlock: number,
): Promise<RawTransferLog[]> {
  const [sent, received] = await Promise.all([
    provider.getLogs({ address: tokenAddress, topics: [TRANSFER_EVENT_TOPIC, paddedAddress, null], fromBlock, toBlock }),
    provider.getLogs({ address: tokenAddress, topics: [TRANSFER_EVENT_TOPIC, null, paddedAddress], fromBlock, toBlock }),
  ]);

  return [...sent, ...received].map((log) => {
    const senderAddress = ethers.getAddress('0x' + log.topics[1].slice(26));
    const receiverAddress = ethers.getAddress('0x' + log.topics[2].slice(26));
    return {
      chain,
      hash: log.transactionHash,
      logIndex: log.index,
      blockNumber: log.blockNumber,
      isReception: receiverAddress.toLowerCase() === walletAddress.toLowerCase(),
      senderAddress,
      receiverAddress,
      amountRaw: BigInt(log.data),
    };
  });
}

/**
 * Collects every Transfer log for `tokenAddress` where `walletAddress` is either the sender
 * or the receiver, until `maxResults` have been found. Backed by a persistent cache
 * (scanCache.ts): a wallet+chain scanned before only has to catch up on blocks produced since
 * the last visit, rather than re-walking the whole lookback window from scratch every time -
 * the historical backward walk below only runs at all when there's no cache yet, or when a
 * caller (e.g. TransactionList asking for more rows than Home ever needed) needs to see
 * further back than what's cached.
 */
async function scanTransferLogs(
  chain: ChainKey,
  tokenAddress: string,
  walletAddress: string,
  maxResults: number,
): Promise<RawTransferLog[]> {
  return scanTransferLogsCore(chain, tokenAddress, walletAddress, maxResults, (call) => withRpcFallback(chain, call));
}

/**
 * Chain-agnostic core of scanTransferLogs: everything above (the persistent cache, the
 * catch-up/historical-walk logic) is identical whether the RPC endpoint comes from CHAINS'
 * per-chain fallback list (curated chains, via scanTransferLogs above) or from a single
 * hand-entered RPC URL (a custom EVM chain added under 設定 > カスタムEVM, via
 * fetchRecentCustomTokenTransfers below) — only *how a provider is obtained* differs, which
 * `runWithProvider` abstracts away.
 */
async function scanTransferLogsCore(
  cacheKeyPrefix: string,
  tokenAddress: string,
  walletAddress: string,
  maxResults: number,
  runWithProvider: <T>(call: (provider: ethers.JsonRpcProvider) => Promise<T>) => Promise<T>,
): Promise<RawTransferLog[]> {
  const paddedAddress = ethers.zeroPadValue(walletAddress, 32);
  const cacheKey = `jpyc:${cacheKeyPrefix}:${tokenAddress}:${walletAddress}`.toLowerCase();
  const cached = await loadScanCache<RawTransferLog>(cacheKey);

  return runWithProvider(async (provider) => {
    const tip = await provider.getBlockNumber();
    const byKey = new Map<string, RawTransferLog>();
    for (const item of cached?.items ?? []) byKey.set(transferLogKey(item), item);

    // 1) Catch up on anything new since this wallet+chain was last scanned. Bounded to
    // LOG_MAX_CHUNKS windows even for a wallet that hasn't been opened in a long time - a
    // very old, never-caught-up gap simply stays unseen rather than ballooning a single load
    // into a huge scan (same bounded-history trade-off the historical walk already makes).
    if (cached && cached.lastScannedBlock < tip) {
      const { items: fresh } = await walkChunkedRange(
        cached.lastScannedBlock + 1,
        tip,
        (fromBlock, toBlock) => fetchTransferLogsInRange(provider, cacheKeyPrefix, tokenAddress, walletAddress, paddedAddress, fromBlock, toBlock),
        undefined,
        LOG_MAX_CHUNKS,
      );
      for (const item of fresh) byKey.set(transferLogKey(item), item);
    }

    // tip + 1 means "nothing has ever been scanned backward yet" (no cache).
    let oldestScannedBlock = cached?.oldestScannedBlock ?? tip + 1;

    // 2) Only walk further into history if what's cached (plus the catch-up above) still
    // doesn't cover what this call needs, and there's unscanned history left below
    // oldestScannedBlock.
    if (byKey.size < maxResults && oldestScannedBlock > 0) {
      const searchFrom = Math.max(oldestScannedBlock - 1 - LOG_MAX_CHUNKS * LOG_CHUNK_BLOCKS + 1, 0);
      const { items: deeper, coveredFromBlock } = await walkChunkedRange(
        searchFrom,
        oldestScannedBlock - 1,
        (fromBlock, toBlock) => fetchTransferLogsInRange(provider, cacheKeyPrefix, tokenAddress, walletAddress, paddedAddress, fromBlock, toBlock),
        (resultsSoFar) => byKey.size + resultsSoFar.length >= maxResults,
        LOG_MAX_CHUNKS,
      );
      for (const item of deeper) byKey.set(transferLogKey(item), item);
      oldestScannedBlock = coveredFromBlock;
    }

    // Most-recent-first within this one chain; block height alone isn't comparable *across*
    // chains (different block times), so cross-chain ordering is resolved later using each
    // log's actual block timestamp.
    const all = Array.from(byKey.values()).sort((a, b) => b.blockNumber - a.blockNumber);
    const capped = all.slice(0, CACHE_ITEM_CAP);

    await saveScanCache(cacheKey, { lastScannedBlock: tip, oldestScannedBlock, items: capped });

    return capped.slice(0, maxResults);
  });
}

const jpycDecimalsCache = new Map<ChainKey, number>();

export async function getJpycDecimals(chain: ChainKey): Promise<number> {
  const cached = jpycDecimalsCache.get(chain);
  if (cached !== undefined) return cached;
  try {
    const decimals = await withRpcFallback(chain, (provider) => {
      const jpyc = new ethers.Contract(CHAINS[chain].jpycAddress, ERC20_ABI, provider);
      return jpyc.decimals() as Promise<bigint>;
    });
    const decimalsNumber = Number(decimals);
    jpycDecimalsCache.set(chain, decimalsNumber);
    return decimalsNumber;
  } catch (e) {
    console.error(`Failed to read JPYC decimals on ${chain}, defaulting to 18`, e);
    return 18;
  }
}

// --- USD display currency support (表示通貨: USD) --------------------------------------
//
// The app's default/only currency used to be JPY, backed 1:1 by JPYC everywhere. Settings >
// 表示通貨 lets someone switch the Home screen (and, deliberately, only QR Lab's 指定金額を
// 受け取る / QRレジスター payment screens) over to USD/USDC instead. USDC's contract address
// and decimals are already known per-chain via the curated TOKEN_LISTS above, so this section
// is just thin, USDC-specific wrappers around the generic token helpers already used for
// custom tokens (fetchTokenMetadata, fetchTokenBalances) and JPYC transfer history above.

/** The curated USDC entry for this chain, or undefined where none is known (e.g. every
 * testnet - see TESTNET_TOKEN_LISTS's empty arrays above). */
export function getUsdcTokenInfo(chain: ChainKey): TokenInfo | undefined {
  return TOKEN_LISTS[chain].find((t) => t.symbol === 'USDC');
}

/**
 * USDC balance for an address on the given chain, formatted like fetchBalances().jpyc.
 * Returns '0' both when the chain has no known USDC contract (debug/testnet mode) and on an
 * RPC failure, so a missing/unreachable USDC contract degrades the same way an unreachable
 * JPYC contract does in fetchBalances() rather than surfacing as an error state.
 */
export async function fetchUsdcBalance(chain: ChainKey, address: string): Promise<string> {
  const usdc = getUsdcTokenInfo(chain);
  if (!usdc) return '0';
  try {
    return await withRpcFallback(chain, async (provider) => {
      const contract = new ethers.Contract(usdc.address, ERC20_ABI, provider);
      const raw = await contract.balanceOf(address) as bigint;
      return ethers.formatUnits(raw, usdc.decimals);
    });
  } catch (e) {
    console.error(`Failed to fetch USDC balance on ${chain}`, e);
    return '0';
  }
}

/**
 * Current JPY value of 1 USD, derived from USDC's own CoinGecko-quoted JPY price (already
 * fetched/cached via fetchTokenJpyRates for the total-assets figure) rather than a separate
 * fiat-exchange-rate API - USDC is USD-pegged 1:1, so its JPY price *is* the USD/JPY rate.
 * Returns 0 (rather than throwing) on failure, same convention as fetchNativeJpyRate.
 */
export async function fetchUsdJpyRate(): Promise<number> {
  const rates = await fetchTokenJpyRates(['USDC']);
  return rates.USDC ?? 0;
}

/**
 * Total portfolio value across every supported chain, converted to USD: reuses
 * fetchTotalAssetsJpy's JPY figure (JPYC + native coins + curated tokens) and converts it with
 * fetchUsdJpyRate, rather than re-deriving every rate a second time in USD. Returns 0 if the
 * USD/JPY rate couldn't be fetched, so a price-feed outage shows "$0" instead of a wildly
 * wrong number.
 */
export async function fetchTotalAssetsUsd(address: string): Promise<number> {
  const [totalJpy, usdJpyRate] = await Promise.all([fetchTotalAssetsJpy(address), fetchUsdJpyRate()]);
  return usdJpyRate > 0 ? totalJpy / usdJpyRate : 0;
}

const blockTimestampCache = new Map<string, number>();

/** Unix timestamp (seconds) of a given block, cached per chain+block for the session. */
export async function getBlockTimestamp(chain: ChainKey, blockNumber: number): Promise<number> {
  const key = `${chain}:${blockNumber}`;
  const cached = blockTimestampCache.get(key);
  if (cached !== undefined) return cached;
  const block = await withRpcFallback(chain, (provider) => provider.getBlock(blockNumber));
  const timestamp = block?.timestamp ?? 0;
  blockTimestampCache.set(key, timestamp);
  return timestamp;
}

/** Same as getBlockTimestamp, but for a custom chain's own single provider rather than a
 * CHAINS-registered ChainKey's fallback list - see fetchRecentCustomTokenTransfers above. */
async function getCustomChainBlockTimestamp(provider: ethers.JsonRpcProvider, chainCacheId: string, blockNumber: number): Promise<number> {
  const key = `${chainCacheId}:${blockNumber}`;
  const cached = blockTimestampCache.get(key);
  if (cached !== undefined) return cached;
  const block = await provider.getBlock(blockNumber);
  const timestamp = block?.timestamp ?? 0;
  blockTimestampCache.set(key, timestamp);
  return timestamp;
}

export interface ChainTransfer {
  // A ChainKey for curated chains, or a CustomChainRecord id for a hand-added network - see
  // RawTransferLog.chain above for why this is a plain string rather than ChainKey.
  chain: string;
  hash: string;
  blockNumber: number;
  isReception: boolean;
  senderAddress: string;
  receiverAddress: string;
  amount: string; // formatted
  currencySymbol: string;
  // Unix timestamp (seconds) of the block this transfer is in - resolved here (not left to
  // the caller) so useTransactions.ts can merge/sort transfers from many chains and tokens
  // without a second round of per-item lookups.
  timestamp: number;
}

/**
 * Recent JPYC transfer history (send + receive) for a wallet on one chain, read directly
 * from public RPC logs - see the block comment above for why this is JPYC-only.
 */
export async function fetchRecentJpycTransfers(chain: ChainKey, walletAddress: string, maxResults: number): Promise<ChainTransfer[]> {
  const decimals = await getJpycDecimals(chain);
  return fetchRecentTokenTransfers(chain, CHAINS[chain].jpycAddress, decimals, 'JPYC', walletAddress, maxResults);
}

/**
 * Generalization of fetchRecentJpycTransfers for an arbitrary ERC-20 contract - used by
 * useJpycPaymentWatcher when it's asked to watch for a USDC payment (QR Lab's 指定金額を
 * 受け取る / QRレジスター, when 表示通貨 is USD) instead of the default JPYC one.
 */
export async function fetchRecentTokenTransfers(
  chain: ChainKey,
  tokenAddress: string,
  decimals: number,
  currencySymbol: string,
  walletAddress: string,
  maxResults: number,
): Promise<ChainTransfer[]> {
  const raw = await scanTransferLogs(chain, tokenAddress, walletAddress, maxResults);
  const withTimestamps = await Promise.all(raw.map(async (log) => ({
    log,
    timestamp: await getBlockTimestamp(chain, log.blockNumber).catch(() => 0),
  })));
  return withTimestamps.map(({ log, timestamp }) => ({
    chain: log.chain,
    hash: log.hash,
    blockNumber: log.blockNumber,
    isReception: log.isReception,
    senderAddress: log.senderAddress,
    receiverAddress: log.receiverAddress,
    amount: ethers.formatUnits(log.amountRaw, decimals),
    currencySymbol,
    timestamp,
  }));
}

/**
 * Same as fetchRecentTokenTransfers, but for a network not in CHAINS - a custom EVM chain
 * added by hand under 設定 > カスタムEVM (see storage.ts's CustomChainRecord). Only a single
 * RPC endpoint is available for these (no curated fallback list), and there's no curated
 * token list either - every token scanned here is one the person registered by hand
 * (CustomTokenRecord). Native-coin history is intentionally not offered for these chains
 * (or any chain) - see the block comment above scanTransferLogs's siblings for why.
 */
export async function fetchRecentCustomTokenTransfers(
  rpcUrl: string,
  chainCacheId: string,
  tokenAddress: string,
  decimals: number,
  currencySymbol: string,
  walletAddress: string,
  maxResults: number,
): Promise<ChainTransfer[]> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const raw = await scanTransferLogsCore(chainCacheId, tokenAddress, walletAddress, maxResults, (call) => call(provider));
  const withTimestamps = await Promise.all(raw.map(async (log) => ({
    log,
    timestamp: await getCustomChainBlockTimestamp(provider, chainCacheId, log.blockNumber).catch(() => 0),
  })));
  return withTimestamps.map(({ log, timestamp }) => ({
    chain: log.chain,
    hash: log.hash,
    blockNumber: log.blockNumber,
    isReception: log.isReception,
    senderAddress: log.senderAddress,
    receiverAddress: log.receiverAddress,
    amount: ethers.formatUnits(log.amountRaw, decimals),
    currencySymbol,
    timestamp,
  }));
}

/**
 * Sends an arbitrary ERC-20 token (identified by contract address + decimals) from the
 * given account to a recipient address on the given chain.
 * @param amount Human-readable amount, e.g. "1.5".
 */
/**
 * Polygon Bor (including Amoy) enforces a minimum priority fee of 25 gwei.
 *
 * Do not rely on provider.getFeeData() here: some public Amoy RPC endpoints
 * report 1.5 gwei even though the Bor node rejects it. We construct the
 * transaction fields explicitly and validate the signed EIP-1559 transaction
 * before broadcasting it.
 */
const POLYGON_MIN_PRIORITY_FEE = ethers.parseUnits('25', 'gwei');
const POLYGON_MAX_PRIORITY_FEE = ethers.parseUnits('30', 'gwei');

// Exported so other modules that broadcast their own transactions (e.g. lib/uniswap.ts's
// swap/approve calls) apply the exact same fee-per-gas policy as ordinary sends — notably
// Polygon's forced 25+ gwei priority fee — instead of duplicating (and risking drifting
// from) this logic.
export async function getGasOverrides(
  chain: ChainKey,
  provider: ethers.JsonRpcProvider,
): Promise<ethers.TransactionRequest> {
  const block = await provider.getBlock('latest');
  const feeData = await provider.getFeeData();

  if (chain === 'polygon') {
    // Use 30 gwei rather than the exact 25 gwei floor so there is no rounding
    // or node-policy edge case. maxFee is also deliberately above the tip.
    const baseFee = block?.baseFeePerGas || feeData.gasPrice || 0n;
    const maxFeePerGas = baseFee * 2n + POLYGON_MAX_PRIORITY_FEE;

    return {
      type: 2,
      maxPriorityFeePerGas: POLYGON_MAX_PRIORITY_FEE,
      maxFeePerGas,
    };
  }

  if (block?.baseFeePerGas) {
    const priority = feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei');
    return {
      type: 2,
      maxPriorityFeePerGas: priority,
      maxFeePerGas: block.baseFeePerGas * 2n + priority,
    };
  }

  return {
    gasPrice: feeData.gasPrice || ethers.parseUnits('1', 'gwei'),
  };
}

/**
 * Sign and broadcast explicitly. This prevents ethers/provider fee estimation
 * from silently replacing the Polygon priority fee with 1.5 gwei.
 */
async function signAndSend(
  chain: ChainKey,
  signer: ethers.Signer,
  transaction: ethers.TransactionRequest,
) {
  if (chain === 'polygon') {
    const priority = transaction.maxPriorityFeePerGas;
    if (priority == null || BigInt(priority) < POLYGON_MIN_PRIORITY_FEE) {
      throw new Error('Polygon Amoy requires a priority fee of at least 25 gwei.');
    }
  }

  if (!(signer instanceof ethers.Wallet)) {
    // MetaMask / Bitget Wallet など外部ウォレット: 署名とブロードキャストは拡張側に任せる
    // (eth_sendTransaction)。nonce もウォレット側の管理に任せる。
    const forExternal = { ...transaction };
    delete forExternal.nonce;
    return signer.sendTransaction(forExternal);
  }

  const raw = await signer.signTransaction(transaction);

  // Verify the exact transaction that will be sent.
  if (chain === 'polygon') {
    const parsed = ethers.Transaction.from(raw);
    if (
      parsed.type !== 2 ||
      parsed.maxPriorityFeePerGas == null ||
      parsed.maxPriorityFeePerGas < POLYGON_MIN_PRIORITY_FEE
    ) {
      throw new Error('Failed to construct a Polygon EIP-1559 transaction with the required 25 gwei priority fee.');
    }
    console.info(
      '[RacoomWallet] Polygon gas:',
      'maxPriorityFeePerGas =',
      ethers.formatUnits(parsed.maxPriorityFeePerGas, 'gwei'),
      'gwei, maxFeePerGas =',
      parsed.maxFeePerGas != null ? ethers.formatUnits(parsed.maxFeePerGas, 'gwei') : 'n/a',
      'gwei',
    );
  }

  return providerFor(chain, CHAINS[chain].rpcUrls[0]).broadcastTransaction(raw);
}

export async function sendErc20(
  chain: ChainKey,
  privateKey: SignerSource,
  tokenAddress: string,
  decimals: number,
  to: string,
  amount: string,
  onBroadcast?: (txHash: string) => void,
) {
  const provider = getProvider(chain);
  const signer = resolveSigner(privateKey, provider);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

  const value = ethers.parseUnits(amount, decimals);
  const gasOverrides = await getGasOverrides(chain, provider);
  const data = token.interface.encodeFunctionData('transfer', [to, value]);
  const gasLimit = await token.transfer.estimateGas(to, value, gasOverrides);
  const nonce = await signer.getNonce('pending');
  const tx = await signAndSend(chain, signer, {
    ...gasOverrides,
    to: tokenAddress,
    data,
    nonce,
    gasLimit,
    chainId: CHAINS[chain].chainId,
  });
  // 送信(ブロードキャスト)が済んだ時点で知らせる。その後、承認(完了)を待つ。
  onBroadcast?.(tx.hash);
  return tx.wait();
}

/**
 * Fetches the sender's balance of one specific token, for the send-amount screen when the
 * person picked an arbitrary token (rather than JPYC/native) to send.
 */
export async function fetchSingleTokenBalance(chain: ChainKey, tokenAddress: string, decimals: number, address: string): Promise<string> {
  const raw = await withRpcFallback(chain, (provider) => {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    return contract.balanceOf(address) as Promise<bigint>;
  });
  return ethers.formatUnits(raw, decimals);
}

/**
 * Sends JPYC from the given account to a recipient address on the given chain.
 * @param amount Human-readable amount, e.g. "1000.5" (JPYC).
 */
export async function sendJpyc(chain: ChainKey, privateKey: SignerSource, to: string, amount: string, onBroadcast?: (txHash: string) => void) {
  const provider = getProvider(chain);
  const signer = resolveSigner(privateKey, provider);
  const jpyc = getJpycContract(chain).connect(signer) as ethers.Contract;

  const decimals: bigint = await jpyc.decimals();
  const value = ethers.parseUnits(amount, decimals);
  const gasOverrides = await getGasOverrides(chain, provider);
  const data = jpyc.interface.encodeFunctionData('transfer', [to, value]);
  const gasLimit = await jpyc.transfer.estimateGas(to, value, gasOverrides);
  const nonce = await signer.getNonce('pending');
  const tx = await signAndSend(chain, signer, {
    ...gasOverrides,
    to: CHAINS[chain].jpycAddress,
    data,
    nonce,
    gasLimit,
    chainId: CHAINS[chain].chainId,
  });
  // 送信(ブロードキャスト)が済んだ時点で知らせる。その後、承認(完了)を待つ。
  onBroadcast?.(tx.hash);
  return tx.wait();
}

/**
 * Sends the chain's native coin (ETH / POL / KAIA) to a recipient address.
 * @param amount Human-readable amount, e.g. "0.01".
 */
export async function sendNative(chain: ChainKey, privateKey: SignerSource, to: string, amount: string, onBroadcast?: (txHash: string) => void) {
  const provider = getProvider(chain);
  const signer = resolveSigner(privateKey, provider);
  const value = ethers.parseUnits(amount, CHAINS[chain].nativeCurrency.decimals);
  const gasOverrides = await getGasOverrides(chain, provider);
  const nonce = await signer.getNonce('pending');
  const gasLimit = await provider.estimateGas({
    to,
    value,
    ...gasOverrides,
    from: await signer.getAddress(),
  });
  const tx = await signAndSend(chain, signer, {
    ...gasOverrides,
    to,
    value,
    nonce,
    gasLimit,
    chainId: CHAINS[chain].chainId,
  });
  // 送信(ブロードキャスト)が済んだ時点で知らせる。その後、承認(完了)を待つ。
  onBroadcast?.(tx.hash);
  return tx.wait();
}

/**
 * Estimates the native-currency gas fee for a not-yet-sent transaction, so the
 * confirmation screen can show "推定" (estimated) figures instead of leaving the fee
 * blank until broadcast. Uses the same fee-per-gas policy as the real send (getGasOverrides
 * - notably Polygon's forced 25+ gwei priority fee) so the estimate matches what will
 * actually be charged. Needs only the sender's address (no private key) since estimateGas
 * doesn't require a signature. Returns null rather than throwing on any failure (bad
 * address, unreachable RPC, reverting call) so a failed estimate degrades to "not
 * available" instead of blocking the confirmation screen.
 */
export async function estimateSendFee(
  chain: ChainKey,
  from: string,
  to: string,
  currency: 'native' | 'jpyc' | 'token',
  amount: string,
  token?: { address: string; decimals: number },
): Promise<string | null> {
  if (!ethers.isAddress(from) || !ethers.isAddress(to)) {
    return null;
  }
  try {
    const provider = getProvider(chain);
    const gasOverrides = await getGasOverrides(chain, provider);
    const feePerGas =
      (gasOverrides.maxFeePerGas as bigint | undefined) ??
      (gasOverrides.gasPrice as bigint | undefined) ??
      0n;

    let gasLimit: bigint;
    if (currency === 'native') {
      let value = 0n;
      try {
        value = ethers.parseUnits(amount || '0', CHAINS[chain].nativeCurrency.decimals);
      } catch {
        // Amount not parsable yet (e.g. still empty/partial) - estimate for a 0-value send.
      }
      gasLimit = await provider.estimateGas({ from, to, value, ...gasOverrides });
    } else {
      const tokenAddress = currency === 'jpyc' ? CHAINS[chain].jpycAddress : token?.address;
      const decimals = currency === 'jpyc' ? await getJpycContract(chain).decimals() : token?.decimals;
      if (!tokenAddress || decimals == null) {
        return null;
      }
      let value = 0n;
      try {
        value = ethers.parseUnits(amount || '0', decimals);
      } catch {
        // As above - fall back to a 0-value estimate.
      }
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const data = contract.interface.encodeFunctionData('transfer', [to, value]);
      gasLimit = await provider.estimateGas({ from, to: tokenAddress, data, ...gasOverrides });
    }

    const feeWei = gasLimit * feePerGas;
    return ethers.formatUnits(feeWei, CHAINS[chain].nativeCurrency.decimals);
  } catch (e) {
    console.warn(`Failed to estimate send fee on ${chain}`, e);
    return null;
  }
}

/**
 * User-facing classification of a failed send, for SendConfirmation's catch block.
 *
 * ethers v6 / RPC errors for a failed broadcast are deeply nested and full of jargon (see
 * the "insufficient funds for gas * price + value: have X want Y" / JSON-RPC -32003 shape),
 * which is meaningless to a non-technical user. This walks the nested error, pulls out the
 * "have"/"want" wei figures when present, and turns them into one of a small set of plain-
 * language cases the UI can render (insufficient gas only, insufficient gas+amount together,
 * gas price too low, or a generic fallback that still surfaces the raw detail for support).
 */
export type SendErrorKind = 'insufficient_gas' | 'insufficient_total' | 'gas_price_too_low' | 'unknown';

export interface ParsedSendError {
  kind: SendErrorKind;
  symbol: string;
  amount?: string;         // human-readable amount the user tried to send (native sends only)
  estimatedFee?: string;   // human-readable estimated gas fee
  requiredTotal?: string;  // human-readable amount + fee combined
  balance?: string;        // human-readable current native balance
  rawMessage: string;      // original error text, for logs / advanced users
}

export interface SendErrorContext {
  chain: ChainKey;
  // Only 'native' sends put the transfer amount itself at risk of being included in the
  // shortfall; JPYC/ERC-20 sends move 0 native value, so any shortfall there is gas-only.
  isNativeSend: boolean;
  amount: string; // human-readable amount attempted, e.g. "0.1"
}

// Digs through ethers v6's nested error wrapping (error.error.error...) and its stringified
// JSON-RPC `body` field to find the actual node-reported message, e.g.
// "insufficient funds for gas * price + value: have 0 want 74609496570000".
export function extractRpcMessage(error: unknown): string {
  let message = '';
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const node = current as Record<string, unknown>;
    if (typeof node.message === 'string') {
      message = node.message;
    }
    if (typeof node.body === 'string') {
      try {
        const parsedBody = JSON.parse(node.body) as { error?: { message?: string } };
        if (parsedBody?.error?.message) {
          message = parsedBody.error.message;
        }
      } catch {
        // body wasn't JSON; ignore and keep whatever message we already have.
      }
    }
    current = node.error;
  }
  if (message) return message;
  return error instanceof Error ? error.message : String(error);
}

export function parseSendError(error: unknown, ctx: SendErrorContext): ParsedSendError {
  const symbol = CHAINS[ctx.chain].nativeCurrency.symbol;
  const decimals = CHAINS[ctx.chain].nativeCurrency.decimals;
  const rawMessage = extractRpcMessage(error);
  const lower = rawMessage.toLowerCase();

  // Thrown directly by signAndSend() before any broadcast, for Polygon's 25 gwei floor.
  if (lower.includes('priority fee of at least 25 gwei')) {
    return { kind: 'gas_price_too_low', symbol, rawMessage };
  }

  // "insufficient funds for gas * price + value: have 0 want 74609496570000"
  const haveWantMatch = rawMessage.match(/have\s+(\d+)\s+want\s+(\d+)/i);
  const looksInsufficient =
    haveWantMatch != null ||
    lower.includes('insufficient funds') ||
    (error as { code?: string } | null)?.code === 'INSUFFICIENT_FUNDS';

  if (looksInsufficient) {
    if (haveWantMatch) {
      const [, haveWei, wantWei] = haveWantMatch;
      const balance = ethers.formatUnits(haveWei, decimals);
      const requiredTotal = ethers.formatUnits(wantWei, decimals);
      if (ctx.isNativeSend) {
        const valueWei = ethers.parseUnits(ctx.amount || '0', decimals);
        const wantBn = BigInt(wantWei);
        const feeWei = wantBn > valueWei ? wantBn - valueWei : wantBn;
        return {
          kind: 'insufficient_total',
          symbol,
          amount: ctx.amount,
          estimatedFee: ethers.formatUnits(feeWei, decimals),
          requiredTotal,
          balance,
          rawMessage,
        };
      }
      return {
        kind: 'insufficient_gas',
        symbol,
        estimatedFee: requiredTotal,
        balance,
        rawMessage,
      };
    }
    // Insufficient-funds error without parsable wei figures (e.g. thrown client-side by
    // ethers before it ever reached the node) - still classify it, just without amounts.
    return { kind: ctx.isNativeSend ? 'insufficient_total' : 'insufficient_gas', symbol, rawMessage };
  }

  // Gas price rejected by the node as too low, under various RPC phrasings.
  if (
    lower.includes('minimum needed') ||
    lower.includes('max fee per gas less than block base fee') ||
    lower.includes('gas price too low') ||
    lower.includes('transaction underpriced') ||
    lower.includes('replacement transaction underpriced')
  ) {
    return { kind: 'gas_price_too_low', symbol, rawMessage };
  }

  return { kind: 'unknown', symbol, rawMessage };
}

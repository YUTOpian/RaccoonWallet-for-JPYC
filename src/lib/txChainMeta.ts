import { CHAINS, isEvmChainKey } from './chains';
import { CHAIN_ICONS } from './chainIcons';
import { CustomChainsHelper } from './storage';
import iconCustomEvm from '../assets/icon_menu_ethereum.png';

/**
 * Resolves the small per-network icon shown next to a transaction row, for any of the chain
 * identifiers TransactionWrapper.chain can carry (curated EVM ChainKey, a CustomChainRecord
 * id). Synchronous and icon-only — CHAIN_ICONS/iconCustomEvm are static imports, so no lookup is needed for the icon alone (unlike
 * name/explorer-link below, which need an async CustomChainsHelper read for custom chains).
 */
export function getTxChainIcon(chainId?: string): string | undefined {
  if (!chainId) return undefined;
  if (isEvmChainKey(chainId)) return CHAIN_ICONS[chainId];
  if (chainId.startsWith('custom-')) return iconCustomEvm;
  return undefined;
}

export interface TxChainDisplay {
  name: string;
  icon?: string;
  /** Native-coin symbol for this chain, used on the fee line - undefined where a fee isn't
   * meaningful to show. */
  nativeCurrencySymbol?: string;
  explorerAddressUrl?: (address: string) => string;
  explorerTxUrl?: (hash: string) => string;
}

/**
 * Full display info (name, explorer links, native-coin symbol) for a transaction's chain -
 * async because a custom EVM chain's name/explorer URL live in local storage
 * (CustomChainsHelper), not in a static table like the curated chains.
 */
export async function resolveTxChainDisplay(chainId?: string): Promise<TxChainDisplay> {
  if (!chainId) return { name: '' };

  if (isEvmChainKey(chainId)) {
    const config = CHAINS[chainId];
    return {
      name: config.name,
      icon: CHAIN_ICONS[chainId],
      nativeCurrencySymbol: config.nativeCurrency.symbol,
      explorerAddressUrl: (address) => `${config.blockExplorerUrl}/address/${address}`,
      explorerTxUrl: (hash) => `${config.blockExplorerUrl}/tx/${hash}`,
    };
  }

  if (chainId.startsWith('custom-')) {
    const record = await CustomChainsHelper.get(chainId);
    return {
      name: record?.name ?? chainId,
      icon: iconCustomEvm,
      nativeCurrencySymbol: record?.currencySymbol,
      explorerAddressUrl: record?.blockExplorerUrl ? (address) => `${record.blockExplorerUrl}/address/${address}` : undefined,
      explorerTxUrl: record?.blockExplorerUrl ? (hash) => `${record.blockExplorerUrl}/tx/${hash}` : undefined,
    };
  }

  return { name: chainId };
}

import { ethers } from 'ethers';
import type { ChainKey } from './chains';
import { CHAIN_ICONS } from './chainIcons';
import type { CustomChainRecord } from './storage';

// The address book's chain picker: the app's EVM chains (see lib/chains.ts's ChainKey).
// Custom networks (`custom:${id}`) are handled separately below.
export type AddressBookChainKey = ChainKey;

export const ADDRESS_BOOK_CHAIN_ORDER: AddressBookChainKey[] = ['ethereum', 'polygon', 'kaia', 'avalanche'];

export const ADDRESS_BOOK_CHAIN_NAMES: Record<AddressBookChainKey, string> = {
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  kaia: 'Kaia',
  avalanche: 'Avalanche',
};

export const ADDRESS_BOOK_CHAIN_ICONS: Record<AddressBookChainKey, string> = { ...CHAIN_ICONS };

// A contact/self wallet's `chain` field (see ContactWallet.chain in lib/storage.ts) is kept
// as a plain string precisely so it can also hold `custom:${id}`, pointing at a network the
// person added by hand under 設定 > カスタムEVM (see CustomChainRecord) - same convention as
// Receive.tsx/Balance.tsx/AssetRecoveryList.tsx's own `custom:${id}` handling. It isn't part
// of the fixed AddressBookChainKey union above since the set of registered custom chains is
// dynamic, not a fixed list this module can enumerate ahead of time.
export function isCustomAddressBookChain(chain: string): chain is `custom:${string}` {
  return chain.startsWith('custom:');
}

export function findCustomAddressBookChain(chain: string, customChains: CustomChainRecord[]): CustomChainRecord | null {
  if (!isCustomAddressBookChain(chain)) return null;
  const id = chain.slice('custom:'.length);
  return customChains.find((c) => c.id === id) ?? null;
}

// Resolves a wallet's `chain` string to a display name, covering both the fixed
// AddressBookChainKey union and a `custom:${id}` value - falls back to the raw chain string
// if a custom chain was since removed under 設定 > カスタムEVM.
export function addressBookChainName(chain: string, customChains: CustomChainRecord[]): string {
  const custom = findCustomAddressBookChain(chain, customChains);
  if (custom) return custom.name;
  return ADDRESS_BOOK_CHAIN_NAMES[chain as AddressBookChainKey] ?? chain;
}

export function isValidAddressForChain(_chain: string, address: string): boolean {
  return ethers.isAddress(address.trim());
}

export function normalizeAddressForChain(_chain: string, address: string): string {
  return address.trim();
}

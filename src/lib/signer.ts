import { ethers } from 'ethers';

/**
 * Where a transaction gets signed. Either a raw private key (wallets created/imported in
 * this app - signed locally) or an already-connected ethers.Signer (MetaMask / Bitget Wallet,
 * see lib/externalWallet.ts - the key never leaves the extension and each transaction is
 * approved inside it).
 */
export type SignerSource = string | ethers.Signer;

export function resolveSigner(source: SignerSource, provider: ethers.Provider): ethers.Signer {
  return typeof source === 'string' ? new ethers.Wallet(source, provider) : source;
}

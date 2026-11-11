import { ethers, HDNodeWallet, Mnemonic, SigningKey, wordlists } from 'ethers';

/**
 * EVM (Ethereum / Polygon / Kaia) account derived from a BIP39 mnemonic or a raw private key.
 * Ethereum, Polygon and Kaia are all EVM-compatible chains, so a single keypair/address
 * works across all three — only the RPC endpoint / chainId differs when sending a transaction.
 *
 * Uses ethers v6.
 */
export interface EvmAccount {
  address: string;
  publicKey: string;
  privateKey: string;
}

// Standard BIP44 path for EVM chains (Ethereum, Polygon and Kaia all use coin type 60).
const DERIVATION_PATH = (index: number) => `m/44'/60'/0'/0/${index}`;

export class MnemonicHelper {
  /**
   * Generates a new random BIP39 mnemonic (12 words, English wordlist).
   */
  static generate(): string {
    const wallet = ethers.Wallet.createRandom();
    return wallet.mnemonic!.phrase;
  }

  /**
   * Validates that a string is a well-formed BIP39 mnemonic (checksum included).
   */
  static isValid(phrase: string): boolean {
    const normalized = MnemonicHelper.normalize(phrase);
    return Mnemonic.isValidMnemonic(normalized);
  }

  /**
   * Normalizes user input: trims, collapses whitespace, lowercases.
   */
  static normalize(phrase: string): string {
    return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Whether a single word exists in the BIP39 English wordlist - used to flag individual
   * word boxes as invalid while typing a recovery phrase, before enough words are entered
   * for isValid()'s full checksum check to mean anything. Blank input isn't itself wrong
   * (the person just hasn't typed that word yet), so it's treated as valid here.
   */
  static isValidWord(word: string): boolean {
    const trimmed = word.trim().toLowerCase();
    if (trimmed.length === 0) {
      return true;
    }
    return wordlists.en.getWordIndex(trimmed) !== -1;
  }

  /**
   * Derives an EVM account from a mnemonic at the given BIP44 index (default: 0, the first account).
   */
  static accountFromMnemonic(phrase: string, index: number = 0): EvmAccount {
    const normalized = MnemonicHelper.normalize(phrase);
    const mnemonic = Mnemonic.fromPhrase(normalized);
    const node = HDNodeWallet.fromMnemonic(mnemonic, DERIVATION_PATH(index));
    return {
      address: node.address,
      publicKey: node.publicKey,
      privateKey: node.privateKey,
    };
  }

  /**
   * Creates a brand new mnemonic and returns both the phrase and its first derived account.
   * Callers should show the phrase to the user for backup before persisting the wallet.
   */
  static createNew(): { phrase: string; account: EvmAccount } {
    const phrase = MnemonicHelper.generate();
    const account = MnemonicHelper.accountFromMnemonic(phrase, 0);
    return { phrase, account };
  }
}

export class PrivateKeyHelper {
  /**
   * Validates a raw EVM private key (32-byte hex string, with or without 0x prefix).
   */
  static isValid(privateKey: string): boolean {
    const normalized = PrivateKeyHelper.normalize(privateKey);
    return ethers.isHexString(normalized, 32);
  }

  static normalize(privateKey: string): string {
    const trimmed = privateKey.trim();
    return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  }

  /**
   * Derives an EVM account (address/publicKey) from a raw private key, e.g. for "import by private key".
   */
  static accountFromPrivateKey(privateKey: string): EvmAccount {
    const normalized = PrivateKeyHelper.normalize(privateKey);
    const signingKey = new SigningKey(normalized);
    return {
      address: ethers.computeAddress(signingKey.publicKey),
      publicKey: signingKey.publicKey,
      privateKey: normalized,
    };
  }
}

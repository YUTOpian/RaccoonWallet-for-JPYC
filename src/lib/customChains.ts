import { ethers } from 'ethers';
import { resolveSigner } from './signer';
import type { SignerSource } from './signer';
import { ERC20_ABI } from './chains';
import type { TokenInfo, TokenBalance } from './chains';

/**
 * Generic, ad-hoc chain access for the "通貨の取り出し" (asset recovery) settings feature.
 * Unlike lib/chains.ts's CHAINS registry (Ethereum/Polygon/Kaia/Avalanche — chains this
 * wallet is actually built for, with curated RPC fallback lists and token lists), this
 * talks to whatever chain + RPC URL the person types in by hand. It exists purely so
 * someone who accidentally sent funds to a chain the wallet doesn't support (Arbitrum,
 * Optimism, etc.) can see what they hold there and get it out — it does NOT make that
 * chain a first-class part of the wallet (no send-flow integration, no RPC fallback list,
 * no curated token list, no debug/testnet counterpart).
 */

/**
 * Confirms the RPC URL actually answers and reports the chainId the person entered, so a
 * mistyped or copy-pasted-for-the-wrong-network RPC URL is caught at add time instead of
 * silently reading balances from the wrong chain. Returns false (rather than throwing) on
 * any failure so the caller can show one generic "接続できませんでした" message.
 */
export async function verifyCustomChainRpc(rpcUrl: string, expectedChainId: number): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    return Number(network.chainId) === expectedChainId;
  } catch {
    return false;
  }
}

// One provider per RPC URL, so re-fetching balances on the same screen doesn't reconnect
// every time. Deliberately separate from lib/chains.ts's providerCache (keyed by ChainKey)
// since these URLs are arbitrary and not part of that registry.
const providerCache = new Map<string, ethers.JsonRpcProvider>();

function providerFor(rpcUrl: string): ethers.JsonRpcProvider {
  let provider = providerCache.get(rpcUrl);
  if (!provider) {
    provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 });
    providerCache.set(rpcUrl, provider);
  }
  return provider;
}

/**
 * Fetches the native-coin balance at `address` on whatever chain `rpcUrl` points at.
 * Assumes 18 decimals — true of every EVM chain's native currency in practice (ETH-based
 * L2s like Arbitrum/Optimism included), same assumption lib/chains.ts's CHAINS make.
 */
export async function fetchCustomChainNativeBalance(rpcUrl: string, address: string): Promise<string> {
  const raw = await providerFor(rpcUrl).getBalance(address);
  return ethers.formatUnits(raw, 18);
}

/**
 * Reads symbol/decimals/name directly from an ERC-20 contract, for registering a token by
 * hand on a custom chain (same idea as lib/chains.ts's fetchTokenMetadata, but against an
 * arbitrary RPC URL instead of a known ChainKey). Throws if the address is malformed or
 * doesn't behave like an ERC-20.
 */
export async function fetchCustomChainTokenMetadata(rpcUrl: string, address: string): Promise<TokenInfo> {
  if (!ethers.isAddress(address)) {
    throw new Error('invalid_address');
  }
  const checksummed = ethers.getAddress(address);
  const contract = new ethers.Contract(checksummed, ERC20_ABI, providerFor(rpcUrl));
  const [symbol, decimals] = await Promise.all([
    contract.symbol() as Promise<string>,
    contract.decimals() as Promise<bigint>,
  ]);
  let name = symbol;
  try {
    name = await (contract.name() as Promise<string>);
  } catch {
    // name() is optional per the ERC-20 standard; fall back to symbol.
  }
  return { address: checksummed, symbol, name, decimals: Number(decimals) };
}

export async function fetchCustomChainTokenBalance(rpcUrl: string, token: TokenInfo, address: string): Promise<TokenBalance> {
  const contract = new ethers.Contract(token.address, ERC20_ABI, providerFor(rpcUrl));
  const raw = await (contract.balanceOf(address) as Promise<bigint>);
  return { ...token, balance: ethers.formatUnits(raw, token.decimals) };
}

// --- Sending / withdrawing ------------------------------------------------------------
//
// This is the actual "取り出し" (withdrawal) step: once the person can see they hold
// something on a chain the wallet doesn't otherwise support, they need to move it
// somewhere the wallet DOES support (an exchange, another wallet, etc). Deliberately kept
// separate from lib/chains.ts's sendNative/sendJpyc/sendErc20 - those take a ChainKey and
// look up gas/fee policy (notably Polygon's forced priority fee) from CHAINS, neither of
// which applies to an arbitrary hand-entered chain. A plain EIP-1559-if-available,
// legacy-gasPrice-otherwise fee policy covers the general case well enough for a one-off
// rescue send.
async function customChainGasOverrides(provider: ethers.JsonRpcProvider): Promise<ethers.TransactionRequest> {
  const feeData = await provider.getFeeData();
  if (feeData.maxFeePerGas != null) {
    return {
      type: 2,
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
    };
  }
  return { gasPrice: feeData.gasPrice ?? undefined };
}

/**
 * Estimates the native-currency gas fee for a not-yet-sent custom-chain transaction, so the
 * send screen can show an "推定" figure before broadcasting. Mirrors lib/chains.ts's
 * estimateSendFee - returns null (rather than throwing) on any failure so a bad address or
 * unreachable RPC degrades to "not available" instead of blocking the screen.
 */
export async function estimateCustomChainSendFee(
  rpcUrl: string,
  from: string,
  to: string,
  amount: string,
  token?: TokenInfo,
): Promise<string | null> {
  if (!ethers.isAddress(from) || !ethers.isAddress(to)) {
    return null;
  }
  try {
    const provider = providerFor(rpcUrl);
    const gasOverrides = await customChainGasOverrides(provider);
    const feePerGas =
      (gasOverrides.maxFeePerGas as bigint | undefined) ??
      (gasOverrides.gasPrice as bigint | undefined) ??
      0n;

    let gasLimit: bigint;
    if (!token) {
      let value = 0n;
      try {
        value = ethers.parseUnits(amount || '0', 18);
      } catch {
        // Amount not parsable yet - estimate for a 0-value send.
      }
      gasLimit = await provider.estimateGas({ from, to, value, ...gasOverrides });
    } else {
      let value = 0n;
      try {
        value = ethers.parseUnits(amount || '0', token.decimals);
      } catch {
        // As above.
      }
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
      const data = contract.interface.encodeFunctionData('transfer', [to, value]);
      gasLimit = await provider.estimateGas({ from, to: token.address, data, ...gasOverrides });
    }

    return ethers.formatUnits(gasLimit * feePerGas, 18);
  } catch (e) {
    console.warn('Failed to estimate custom-chain send fee', e);
    return null;
  }
}

/** Sends the custom chain's native coin. `amount` is human-readable, e.g. "0.01". */
export async function sendCustomChainNative(
  rpcUrl: string,
  chainId: number,
  privateKey: SignerSource,
  to: string,
  amount: string,
  onBroadcast?: (txHash: string) => void,
) {
  const provider = providerFor(rpcUrl);
  const signer = resolveSigner(privateKey, provider);
  const value = ethers.parseUnits(amount, 18);
  const gasOverrides = await customChainGasOverrides(provider);
  const nonce = await signer.getNonce('pending');
  const gasLimit = await provider.estimateGas({ to, value, from: await signer.getAddress(), ...gasOverrides });
  const tx = await signer.sendTransaction({ ...gasOverrides, to, value, nonce, gasLimit, chainId });
  onBroadcast?.(tx.hash);
  return tx.wait();
}

/** Sends an ERC-20 token registered on a custom chain. `amount` is human-readable. */
export async function sendCustomChainToken(
  rpcUrl: string,
  chainId: number,
  privateKey: SignerSource,
  token: TokenInfo,
  to: string,
  amount: string,
  onBroadcast?: (txHash: string) => void,
) {
  const provider = providerFor(rpcUrl);
  const signer = resolveSigner(privateKey, provider);
  const contract = new ethers.Contract(token.address, ERC20_ABI, signer);
  const value = ethers.parseUnits(amount, token.decimals);
  const gasOverrides = await customChainGasOverrides(provider);
  const data = contract.interface.encodeFunctionData('transfer', [to, value]);
  const gasLimit = await contract.transfer.estimateGas(to, value, gasOverrides);
  const nonce = await signer.getNonce('pending');
  const tx = await signer.sendTransaction({ ...gasOverrides, to: token.address, data, nonce, gasLimit, chainId });
  onBroadcast?.(tx.hash);
  return tx.wait();
}

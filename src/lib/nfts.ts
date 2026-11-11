import { ethers } from 'ethers';
import localForage from 'localforage';
import i18n from '../i18n';
import { CHAINS, getNetworkMode, withRpcFallback } from './chains';
import type { ChainKey, NetworkMode } from './chains';
import { notify } from '../store/notificationStore';

/**
 * NFT保有一覧。
 *
 * 公開RPCの eth_getLogs では過去のNFTを確実には探せない(lib/chains.ts の LOG_MAX_CHUNKS の
 * コメント参照)ため、有料のインデクサーには頼らず、次の2通りで一覧に載せる:
 *  1. dApp接続(lib/walletConnect.ts)で送信した取引が成功したら、そのレシートの
 *     Transfer ログから「自分宛てに届いたNFT」を拾って自動で追加する。
 *  2. すでに持っているNFTは、コントラクトアドレスとトークンIDで手動追加する。
 * 表示のたびに所有状況(ownerOf / balanceOf)をチェーンから読み直すので、売却・送付して
 * 手元から無くなったものは「保有していません」と分かる。
 */

export type NftStandard = 'erc721' | 'erc1155';

export interface NftRecord {
  /** 本番/デバッグ(テストネット)のどちらで登録したか。モードが違うものは一覧に出さない。 */
  mode: NetworkMode;
  chain: ChainKey;
  contract: string;
  tokenId: string;
  standard: NftStandard;
  /** 持ち主のウォレットアドレス(複数ウォレットを使い分けても混ざらないように)。 */
  owner: string;
  addedAt: number;
}

interface PendingTx {
  mode: NetworkMode;
  chain: ChainKey;
  hash: string;
  owner: string;
}

const NFTS_KEY = 'RACCOON_NFTS';
const PENDING_KEY = 'RACCOON_NFT_PENDING_TXS';

const sameRecord = (a: NftRecord, b: NftRecord) =>
  a.mode === b.mode && a.chain === b.chain && a.standard === b.standard &&
  a.contract.toLowerCase() === b.contract.toLowerCase() && a.tokenId === b.tokenId &&
  a.owner.toLowerCase() === b.owner.toLowerCase();

async function loadAll(): Promise<NftRecord[]> {
  try {
    return (await localForage.getItem<NftRecord[]>(NFTS_KEY)) ?? [];
  } catch {
    return [];
  }
}

async function loadPending(): Promise<PendingTx[]> {
  try {
    return (await localForage.getItem<PendingTx[]>(PENDING_KEY)) ?? [];
  } catch {
    return [];
  }
}

export class NftHelper {
  /** 今のネットワークモードで、このウォレットが持つものとして登録されているNFT(新しい順)。 */
  static async list(owner: string): Promise<NftRecord[]> {
    const mode = getNetworkMode();
    const all = await loadAll();
    return all
      .filter((r) => r.mode === mode && r.owner.toLowerCase() === owner.toLowerCase())
      .sort((a, b) => b.addedAt - a.addedAt);
  }

  /** 追加する。すでにあれば何もしない。新しく追加できたら true。 */
  static async add(record: NftRecord): Promise<boolean> {
    const all = await loadAll();
    if (all.some((r) => sameRecord(r, record))) return false;
    all.push(record);
    await localForage.setItem(NFTS_KEY, all);
    return true;
  }

  static async remove(record: NftRecord): Promise<void> {
    const all = await loadAll();
    await localForage.setItem(NFTS_KEY, all.filter((r) => !sameRecord(r, record)));
  }
}

// ---------------------------------------------------------------- 所有状況・メタデータ

const ERC165_ABI = ['function supportsInterface(bytes4) view returns (bool)'];
const ERC721_ABI = [
  ...ERC165_ABI,
  'function ownerOf(uint256) view returns (address)',
  'function tokenURI(uint256) view returns (string)',
  'function name() view returns (string)',
];
const ERC1155_ABI = [
  ...ERC165_ABI,
  'function balanceOf(address,uint256) view returns (uint256)',
  'function uri(uint256) view returns (string)',
];

const ERC721_INTERFACE_ID = '0x80ac58cd';
const ERC1155_INTERFACE_ID = '0xd9b67a26';

/** コントラクトが ERC-721 か ERC-1155 かを調べる。どちらでもなければ null。 */
export async function detectStandard(chain: ChainKey, contract: string): Promise<NftStandard | null> {
  return withRpcFallback(chain, async (provider) => {
    const c = new ethers.Contract(contract, ERC165_ABI, provider);
    try {
      if (await c.supportsInterface(ERC721_INTERFACE_ID)) return 'erc721' as const;
      if (await c.supportsInterface(ERC1155_INTERFACE_ID)) return 'erc1155' as const;
    } catch {
      // supportsInterface 非対応のコントラクト
    }
    return null;
  });
}

/** このウォレットが今そのNFTを持っているか。 */
export async function isHolding(r: Pick<NftRecord, 'chain' | 'contract' | 'tokenId' | 'standard'>, owner: string): Promise<boolean> {
  return withRpcFallback(r.chain, async (provider) => {
    if (r.standard === 'erc721') {
      const c = new ethers.Contract(r.contract, ERC721_ABI, provider);
      try {
        const current = String(await c.ownerOf(BigInt(r.tokenId)));
        return current.toLowerCase() === owner.toLowerCase();
      } catch {
        // 存在しない/焼却済みのトークンIDは ownerOf が revert する
        return false;
      }
    }
    const c = new ethers.Contract(r.contract, ERC1155_ABI, provider);
    const balance: bigint = await c.balanceOf(owner, BigInt(r.tokenId));
    return balance > 0n;
  });
}

export interface NftMeta {
  collectionName: string;
  name: string;
  image: string;
}

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

/** ipfs:// などをブラウザで開ける https:// に直す。扱えない形式は空文字。 */
export function resolveMediaUri(uri: string): string {
  const u = uri.trim();
  if (u.startsWith('ipfs://ipfs/')) return IPFS_GATEWAY + u.slice('ipfs://ipfs/'.length);
  if (u.startsWith('ipfs://')) return IPFS_GATEWAY + u.slice('ipfs://'.length);
  if (u.startsWith('https://') || u.startsWith('http://') || u.startsWith('data:image/')) return u;
  return '';
}

function decodeDataJson(uri: string): unknown {
  // data:application/json;base64,xxxx または data:application/json;utf8,{...}
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const head = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  const text = head.includes(';base64')
    ? new TextDecoder().decode(Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0)))
    : decodeURIComponent(body);
  return JSON.parse(text);
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 画像・名前・コレクション名を読む。読めなかった項目は空文字のまま返す(エラーにしない)。 */
export async function fetchNftMeta(r: Pick<NftRecord, 'chain' | 'contract' | 'tokenId' | 'standard'>): Promise<NftMeta> {
  const meta: NftMeta = { collectionName: '', name: '', image: '' };
  try {
    let tokenUri = '';
    await withRpcFallback(r.chain, async (provider) => {
      if (r.standard === 'erc721') {
        const c = new ethers.Contract(r.contract, ERC721_ABI, provider);
        tokenUri = String(await c.tokenURI(BigInt(r.tokenId)));
        try {
          meta.collectionName = String(await c.name());
        } catch {
          // name() を持たないコントラクト
        }
      } else {
        const c = new ethers.Contract(r.contract, ERC1155_ABI, provider);
        tokenUri = String(await c.uri(BigInt(r.tokenId)));
      }
    });
    // ERC-1155 の uri は {id} を 64桁の16進(0埋め)に置き換える決まり。
    tokenUri = tokenUri.replace('{id}', BigInt(r.tokenId).toString(16).padStart(64, '0'));

    let json: unknown = null;
    if (tokenUri.startsWith('data:')) {
      json = decodeDataJson(tokenUri);
    } else {
      const url = tokenUri.startsWith('ipfs://') ? resolveMediaUri(tokenUri) : tokenUri;
      if (url.startsWith('https://') || url.startsWith('http://')) json = await fetchJson(url);
    }
    const obj = (json ?? {}) as { name?: unknown; image?: unknown; image_url?: unknown };
    if (typeof obj.name === 'string') meta.name = obj.name;
    const img = typeof obj.image === 'string' ? obj.image : typeof obj.image_url === 'string' ? obj.image_url : '';
    meta.image = resolveMediaUri(img);
  } catch (e) {
    console.warn('Failed to load NFT metadata', r.contract, r.tokenId, e);
  }
  return meta;
}

// ---------------------------------------------------------------- 取引レシートから自動追加

const TRANSFER_721_TOPIC = ethers.id('Transfer(address,address,uint256)');
const TRANSFER_SINGLE_TOPIC = ethers.id('TransferSingle(address,address,address,uint256,uint256)');
const TRANSFER_BATCH_TOPIC = ethers.id('TransferBatch(address,address,address,uint256[],uint256[])');

const topicToAddress = (topic: string) => ethers.getAddress('0x' + topic.slice(26));

/** レシートのログから「owner 宛てに届いた NFT」を取り出す。 */
export function extractNftsFromReceipt(
  receipt: Pick<ethers.TransactionReceipt, 'logs'>,
  owner: string,
): { contract: string; tokenId: string; standard: NftStandard }[] {
  const found: { contract: string; tokenId: string; standard: NftStandard }[] = [];
  const me = owner.toLowerCase();
  for (const log of receipt.logs) {
    try {
      const t = log.topics;
      if (t[0] === TRANSFER_721_TOPIC && t.length === 4) {
        // ERC-20 の Transfer は topics が3つ。4つ目(tokenId)があるものだけが ERC-721。
        if (topicToAddress(t[2]).toLowerCase() === me) {
          found.push({ contract: log.address, tokenId: BigInt(t[3]).toString(), standard: 'erc721' });
        }
      } else if (t[0] === TRANSFER_SINGLE_TOPIC && t.length === 4) {
        if (topicToAddress(t[3]).toLowerCase() === me) {
          const [id] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], log.data);
          found.push({ contract: log.address, tokenId: BigInt(id).toString(), standard: 'erc1155' });
        }
      } else if (t[0] === TRANSFER_BATCH_TOPIC && t.length === 4) {
        if (topicToAddress(t[3]).toLowerCase() === me) {
          const [ids] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256[]', 'uint256[]'], log.data);
          for (const id of ids as bigint[]) {
            found.push({ contract: log.address, tokenId: BigInt(id).toString(), standard: 'erc1155' });
          }
        }
      }
    } catch (e) {
      console.warn('Skipping an unparsable log while looking for NFTs', e);
    }
  }
  return found;
}

async function addFromReceipt(chain: ChainKey, receipt: ethers.TransactionReceipt, owner: string): Promise<number> {
  let added = 0;
  for (const nft of extractNftsFromReceipt(receipt, owner)) {
    const isNew = await NftHelper.add({
      mode: getNetworkMode(),
      chain,
      contract: ethers.getAddress(nft.contract),
      tokenId: nft.tokenId,
      standard: nft.standard,
      owner: ethers.getAddress(owner),
      addedAt: Date.now(),
    });
    if (isNew) added++;
  }
  return added;
}

async function savePending(list: PendingTx[]) {
  await localForage.setItem(PENDING_KEY, list);
}

async function dropPending(hash: string) {
  await savePending((await loadPending()).filter((p) => p.hash !== hash));
}

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * dApp経由で送信した取引を見張り、取り込まれたら自分宛てのNFTを一覧に追加する。
 * アプリを閉じて見届けられなかった場合に備えて取引ハッシュを保存しておき、
 * 次にNFT画面を開いた時(syncPendingNftTxs)に続きを処理する。
 */
export async function trackTxForNfts(chain: ChainKey, hash: string, owner: string): Promise<void> {
  const pending = await loadPending();
  if (!pending.some((p) => p.hash === hash)) {
    pending.push({ mode: getNetworkMode(), chain, hash, owner: ethers.getAddress(owner) });
    await savePending(pending);
  }
  void (async () => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const receipt = await withRpcFallback(chain, (p) => p.getTransactionReceipt(hash));
        if (receipt) {
          if (receipt.status === 1) {
            const added = await addFromReceipt(chain, receipt, owner);
            if (added > 0) {
              notify({ severity: 'success', message: i18n.t('nft.notice_added', { count: added }) });
            }
          }
          await dropPending(hash);
          return;
        }
      } catch (e) {
        console.warn('Receipt polling failed, will retry', e);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    // 時間切れ: pending に残してあるので、次回の syncPendingNftTxs で再確認する。
  })();
}

/** 保存済みの未確認取引を1回だけ確認し、追加できたNFTの数を返す。 */
export async function syncPendingNftTxs(owner: string): Promise<number> {
  const mode = getNetworkMode();
  const mine = (await loadPending()).filter((p) => p.mode === mode && p.owner.toLowerCase() === owner.toLowerCase());
  let added = 0;
  for (const p of mine) {
    try {
      const receipt = await withRpcFallback(p.chain, (provider) => provider.getTransactionReceipt(p.hash));
      if (!receipt) continue;
      if (receipt.status === 1) added += await addFromReceipt(p.chain, receipt, owner);
      await dropPending(p.hash);
    } catch (e) {
      console.warn('Failed to sync a pending NFT transaction', p.hash, e);
    }
  }
  return added;
}

export function chainLabel(chain: ChainKey): string {
  return CHAINS[chain].name;
}

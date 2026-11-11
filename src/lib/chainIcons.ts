import type { ChainKey } from './chains';
import iconEthereum from '../assets/icon_chain_ethereum.png';
import iconPolygon from '../assets/icon_chain_polygon.png';
import iconKaia from '../assets/icon_chain_kaia.png';
import iconAvalanche from '../assets/icon_chain_avalanche.png';

// Small per-network logo shown next to a transaction row so a merged, multi-chain history
// list (Home, TransactionList) stays readable — without this there'd be no way to tell
// which network a given JPYC transfer happened on.
export const CHAIN_ICONS: Record<ChainKey, string> = {
  ethereum: iconEthereum,
  polygon: iconPolygon,
  kaia: iconKaia,
  avalanche: iconAvalanche,
};

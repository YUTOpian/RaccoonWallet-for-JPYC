import { useEffect, useState } from 'react';
import { CHAINS } from '../lib/chains';
import type { ChainKey } from '../lib/chains';
import { fetchRelayerInfo } from '../lib/gasless';
import { Storage } from '../lib/storage';

/**
 * 設定されたリレイヤーが、この鎖のJPYC送金を引き受けられるか。
 * 未設定・つながらない・この鎖に対応していない場合は available=false(ガスレスの選択肢を出さない)。
 */
export function useGaslessOption(chain: ChainKey | null): { available: boolean; relayerUrl: string } {
  const [state, setState] = useState({ available: false, relayerUrl: '' });
  useEffect(() => {
    let cancelled = false;
    setState({ available: false, relayerUrl: '' });
    if (chain === null) return;
    (async () => {
      const url = await Storage.loadRelayerUrl();
      if (url === '' || cancelled) return;
      const info = await fetchRelayerInfo(url);
      if (cancelled || info === null) return;
      if (info.chains.includes(CHAINS[chain].chainId)) setState({ available: true, relayerUrl: url });
    })();
    return () => {
      cancelled = true;
    };
  }, [chain]);
  return state;
}

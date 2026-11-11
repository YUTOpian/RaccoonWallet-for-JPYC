import { useEffect, useState } from 'react';
import { CHAINS, TOKEN_LISTS } from '../lib/chains';
import type { ChainKey } from '../lib/chains';
import { assessAddress } from '../lib/addressSafety';
import type { PeerEvent, SafetyAssessment, SafetyContact, SentRecipient } from '../lib/addressSafety';
import { AddressBookHelper, RecipientSafetyHelper, WalletsHelper } from '../lib/storage';

/** 送ると戻らない、各鎖のトークンコントラクト(JPYC・主要トークン)。 */
export function knownTokenContracts(): Set<string> {
  const out = new Set<string>();
  for (const key of Object.keys(CHAINS) as ChainKey[]) {
    out.add(CHAINS[key].jpycAddress.toLowerCase());
    for (const token of TOKEN_LISTS[key]) out.add(token.address.toLowerCase());
  }
  return out;
}

export interface SafetyContext {
  contacts: SafetyContact[];
  sent: SentRecipient[];
  peers: PeerEvent[];
}

/** 端末内のアドレス帳・送信済み・履歴の記録をまとめて読む(読めなかった分は空として扱う)。 */
export async function loadSafetyContext(walletAddress: string | null): Promise<SafetyContext> {
  const settle = async <T,>(task: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await task;
    } catch (e) {
      console.warn('address safety data unavailable', e);
      return fallback;
    }
  };
  const [contacts, sent, peers] = await Promise.all([
    settle(AddressBookHelper.list(), []),
    settle(RecipientSafetyHelper.listSent(), []),
    walletAddress ? settle(RecipientSafetyHelper.listPeers(walletAddress), []) : Promise.resolve([] as PeerEvent[]),
  ]);
  return {
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, wallets: c.wallets.map((w) => ({ chain: w.chain, address: w.address })) })),
    sent,
    peers,
  };
}

/**
 * 宛先のアドレス詐欺対策の判定(端末内のアドレス帳・送信済み・取得済みの履歴だけを使う)。
 * 読み込み中は null。`to` が空/アドレスとして不完全な間は判定しない(null)。
 */
export function useAddressSafety(to: string, chain: string | null): SafetyAssessment | null {
  const [assessment, setAssessment] = useState<SafetyAssessment | null>(null);
  const target = to.trim();

  useEffect(() => {
    let cancelled = false;
    setAssessment(null);
    if (chain === null || !/^0x[0-9a-fA-F]{40}$/.test(target)) return;
    (async () => {
      let wallet: Awaited<ReturnType<typeof WalletsHelper.getActive>> = null;
      try {
        wallet = await WalletsHelper.getActive();
      } catch (e) {
        console.warn('active wallet unavailable', e);
      }
      // 読み込めなくても判定は出す(知っている相手が無い扱い = 「初めての相手」として確認が出る側に倒す)。
      const context = await loadSafetyContext(wallet?.address ?? null);
      if (cancelled) return;
      setAssessment(assessAddress({ to: target, chain, self: wallet?.address ?? null, ...context, tokenContracts: knownTokenContracts() }));
    })();
    return () => {
      cancelled = true;
    };
  }, [target, chain]);

  return assessment;
}

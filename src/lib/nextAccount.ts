import { HDNodeWallet, Mnemonic } from 'ethers';
import { MnemonicHelper } from './mnemonic';
import type { Wallet } from './storage';

// 同じリカバリーフレーズ(BIP44 m/44'/60'/0'/0/{index})から作った「次のインデックス番号」を返す。
// すでに登録済みのウォレットのうち、このフレーズから導出したアドレスと一致するものを
// 先頭から走査して使用済みインデックスを求め、その最大値+1 を次のインデックスとする
// (1件も一致しなければ 0)。ウォレットを途中で削除していても、秘密鍵インポートが
// 混ざっていても、既存アカウントとアドレスが衝突しない。
export function findNextAccountIndex(phrase: string, wallets: Wallet[]): number {
  const used = new Set<number>();
  for (const w of wallets) {
    if (typeof w.derivationIndex === 'number') used.add(w.derivationIndex);
  }
  const addresses = new Set(wallets.map((w) => w.address.toLowerCase()));
  const mnemonic = Mnemonic.fromPhrase(MnemonicHelper.normalize(phrase));
  const scanUntil = wallets.length + 10;
  for (let i = 0; i < scanUntil; i++) {
    const address = HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`).address.toLowerCase();
    if (addresses.has(address)) used.add(i);
  }
  return used.size === 0 ? 0 : Math.max(...used) + 1;
}

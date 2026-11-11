# JPYC ガスレス送金リレイヤー(サンプル)

ウォレットアプリ(RacoomWallet-SP)の「ガスレス送金」用の中継サーバーです。
ユーザーが署名した EIP-3009 `transferWithAuthorization` を受け取り、**リレイヤー自身のウォレットがガス代を払って**送金を実行します。

> ⚠️ これは動作確認用のサンプルです。実チェーンでの検証は未実施のため、少額のテスト(Amoy等)から始めてください。

## 仕組みと安全性
- 署名には `from / to / value / validAfter / validBefore / nonce` が含まれます。リレイヤーは宛先・金額を変えられません(変えると署名が無効になります)。
- ウォレットアプリは署名の有効期限を1時間にしています。リレイヤーは24時間を超える署名を拒否します。
- リレイヤーが送らなければ送金は起きません。ユーザー側に残るリスクは「遅れる/実行されない」だけです。

## 運営者が負担するもの
- **ガス代はすべてリレイヤーのウォレットが負担します。** 悪用されると残高が減ります。
  - `ALLOWED_ORIGINS`(ブラウザからの呼び出し元の制限)
  - `MAX_PER_ADDRESS_PER_DAY`(送信元アドレスごとの1日の上限。サンプルは Worker のメモリ上の簡易カウンタなので、本番は KV / Durable Objects に置き換えてください)
  - 最小金額の設定や、JPYCでの手数料徴収(`value` に手数料を含める設計)は、必要に応じて `handler.mjs` を拡張してください。
- リレイヤー用ウォレットには少額のPOL/ETH/AVAXだけを入れ、秘密鍵は `wrangler secret` で管理してください。

## デプロイ(Cloudflare Workers)
```bash
cd relayer
npm install
# wrangler.toml の CHAINS_JSON / ALLOWED_ORIGINS を編集
npx wrangler secret put RELAYER_PRIVATE_KEY
npx wrangler deploy
```
デプロイ後のURL(例: `https://jpyc-relayer.<name>.workers.dev`)を、アプリの 設定 → ガスレス送金 に入力します。

## API
- `GET /info` → `{ "chains": [137] }`
- `POST /relay` ← アプリが送る署名データ → `{ "txHash": "0x…" }` / `{ "error": "…" }`

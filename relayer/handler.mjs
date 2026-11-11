// ガスレス送金リレイヤーの中核ロジック(実行環境に依存しない部分)。
// Cloudflare Workers でも Node でも、fetch 互換の Request/Response があれば動く。
import { ethers } from 'ethers';

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const TOKEN_ABI = [
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
];

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

/**
 * @param {object} deps
 * @param {() => number[]} deps.chainIds                      受け付けるチェーンID
 * @param {(chainId:number) => Promise<{token:string, domain:object, submit:(args:any[]) => Promise<string>, simulate:(args:any[]) => Promise<void>}>} deps.getChain
 * @param {(from:string) => Promise<boolean>} [deps.allow]    送信元ごとの上限などの判定(false で 429)
 * @param {(origin:string|null) => string|null} deps.corsOrigin  許可するOrigin(許可しないなら null)
 * @param {() => number} [deps.now]                           秒
 */
export function createHandler(deps) {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  return async function handle(request) {
    const origin = request.headers.get('origin');
    const allowed = deps.corsOrigin(origin);
    const cors = allowed
      ? { 'access-control-allow-origin': allowed, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' }
      : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/info') {
      return json({ chains: deps.chainIds() }, 200, cors);
    }
    if (request.method !== 'POST' || url.pathname !== '/relay') return json({ error: 'not found' }, 404, cors);
    if (origin !== null && !allowed) return json({ error: 'origin not allowed' }, 403, cors);

    let p;
    try {
      p = await request.json();
    } catch {
      return json({ error: 'invalid json' }, 400, cors);
    }

    try {
      if (!deps.chainIds().includes(p.chainId)) return json({ error: 'unsupported chain' }, 400, cors);
      const chain = await deps.getChain(p.chainId);
      if (typeof p.token !== 'string' || p.token.toLowerCase() !== chain.token.toLowerCase()) return json({ error: 'unsupported token' }, 400, cors);
      if (!ethers.isAddress(p.from) || !ethers.isAddress(p.to) || p.to === ethers.ZeroAddress) return json({ error: 'invalid address' }, 400, cors);
      if (typeof p.value !== 'string' || !/^\d+$/.test(p.value) || BigInt(p.value) === 0n) return json({ error: 'invalid value' }, 400, cors);
      if (!Number.isInteger(p.validAfter) || !Number.isInteger(p.validBefore)) return json({ error: 'invalid validity window' }, 400, cors);
      const t = now();
      if (p.validAfter > t) return json({ error: 'not yet valid' }, 400, cors);
      if (p.validBefore < t + 120) return json({ error: 'authorization expires too soon' }, 400, cors);
      if (p.validBefore > t + 24 * 3600) return json({ error: 'authorization valid for too long' }, 400, cors);
      if (typeof p.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(p.nonce)) return json({ error: 'invalid nonce' }, 400, cors);
      if (typeof p.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(p.signature)) return json({ error: 'invalid signature' }, 400, cors);

      // 署名が from 本人のものか(コントラクトも検証するが、ガスを使う前にここで弾く)
      const message = { from: p.from, to: p.to, value: BigInt(p.value), validAfter: p.validAfter, validBefore: p.validBefore, nonce: p.nonce };
      const signer = ethers.verifyTypedData(chain.domain, TYPES, message, p.signature);
      if (signer.toLowerCase() !== p.from.toLowerCase()) return json({ error: 'signature does not match sender' }, 400, cors);

      if (deps.allow && !(await deps.allow(p.from))) return json({ error: 'rate limited' }, 429, cors);

      const { v, r, s } = ethers.Signature.from(p.signature);
      const args = [p.from, p.to, BigInt(p.value), p.validAfter, p.validBefore, p.nonce, v, r, s];
      try {
        await chain.simulate(args); // 残高不足・使用済みnonceなどは、ガスを使う前にここで分かる
      } catch {
        return json({ error: 'transfer would fail (balance or authorization)' }, 400, cors);
      }
      const txHash = await chain.submit(args);
      return json({ txHash }, 200, cors);
    } catch (e) {
      console.error('relay failed', e);
      return json({ error: 'relay failed' }, 502, cors);
    }
  };
}

export { TOKEN_ABI, TYPES };

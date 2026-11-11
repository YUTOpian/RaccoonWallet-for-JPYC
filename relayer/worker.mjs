// Cloudflare Workers 用のエントリ。設定は環境変数/シークレットで渡す(README.md 参照)。
import { ethers } from 'ethers';
import { createHandler, TOKEN_ABI } from './handler.mjs';

const TOKEN_META_ABI = ['function name() view returns (string)', 'function version() view returns (string)', 'function DOMAIN_SEPARATOR() view returns (bytes32)'];

let cachedHandler = null;
const domains = new Map();

function build(env) {
  const chains = JSON.parse(env.CHAINS_JSON); // {"137":{"rpc":"https://...","token":"0x..."}}
  const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const perDay = Number(env.MAX_PER_ADDRESS_PER_DAY ?? 20);
  const memory = new Map(); // KV を使わない簡易版(Worker が再起動すると数え直し)。本番は KV/Durable Objects 推奨。

  return createHandler({
    chainIds: () => Object.keys(chains).map(Number),
    corsOrigin: (origin) => (origin !== null && origins.includes(origin) ? origin : null),
    allow: async (from) => {
      const day = Math.floor(Date.now() / 86_400_000);
      const key = `${day}:${from.toLowerCase()}`;
      const used = memory.get(key) ?? 0;
      if (used >= perDay) return false;
      memory.set(key, used + 1);
      return true;
    },
    getChain: async (chainId) => {
      const cfg = chains[String(chainId)];
      const provider = new ethers.JsonRpcProvider(cfg.rpc, chainId, { staticNetwork: true });
      const wallet = new ethers.Wallet(env.RELAYER_PRIVATE_KEY, provider);
      const token = new ethers.Contract(cfg.token, TOKEN_ABI, wallet);
      let domain = domains.get(chainId);
      if (!domain) {
        const meta = new ethers.Contract(cfg.token, TOKEN_META_ABI, provider);
        const [name, separator] = await Promise.all([meta.name(), meta.DOMAIN_SEPARATOR()]);
        let version = '1';
        try { version = await meta.version(); } catch { /* 既定値 */ }
        domain = { name, version, chainId, verifyingContract: cfg.token };
        if (ethers.TypedDataEncoder.hashDomain(domain).toLowerCase() !== separator.toLowerCase()) throw new Error('domain mismatch');
        domains.set(chainId, domain);
      }
      return {
        token: cfg.token,
        domain,
        simulate: (args) => token.transferWithAuthorization.staticCall(...args),
        submit: async (args) => (await token.transferWithAuthorization(...args)).hash,
      };
    },
  });
}

export default {
  async fetch(request, env) {
    cachedHandler ??= build(env);
    return cachedHandler(request);
  },
};

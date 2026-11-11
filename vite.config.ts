import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// A single build target that works both ways:
//
// 1. Double-clicked directly as a local file (file://index.html): normal Vite output uses
//    `<script type="module" src="...">`, which Chrome (and others) block from loading over
//    file:// due to CORS. vite-plugin-singlefile avoids that entirely by inlining every
//    JS/CSS/image/font into one self-contained index.html with no external references at
//    all — nothing to be blocked from fetching.
// 2. Hosted on GitHub Pages (or any static host, at any subpath): `base: './'` makes every
//    reference relative, and react-router-dom's HashRouter (see src/router.tsx) keeps all
//    routing state in the URL fragment, so no server-side rewrite rules are needed.
//
// The trade-off is no code-splitting — everything ships in one ~3MB file rather than
// small per-route chunks — but that's an acceptable cost for a wallet app of this size to
// stay usable both ways from a single build.
export default defineConfig({
  base: './',
  // Nothing in index.html references files from public/ anymore (the favicon is inlined
  // as a data URI below), so skip copying it — dist/ ends up containing exactly one file.
  publicDir: false,
  plugins: [
    react(),
    // Only 'buffer' (this app's own code in lib/symbolAccount.ts / lib/symbolChain.ts
    // uses the Buffer global directly) and 'process' (symbol-sdk's ed25519.js reads
    // process.env.SYMBOL_SDK_NO_WASM - see lib/symbolAccount.ts for why that's set) are
    // needed. Both are simple, self-contained polyfills with no further Node builtin
    // dependencies of their own, unlike the aliased-away modules above.
    nodePolyfills({ include: ['buffer', 'process'] }),
    viteSingleFile({ removeViteModuleLoader: true }),
  ],
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
})

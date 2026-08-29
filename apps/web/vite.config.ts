import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Resolve a path relative to this config file (works regardless of cwd).
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Point the workspace packages at their TypeScript SOURCE, mirroring the
    // "paths" in tsconfig.base.json. The packages' dist/ is emitted as CommonJS
    // for the Node API server, and Rollup cannot statically see named exports
    // that CJS re-exports via `__exportStar` (`export * from './voice'`), which
    // breaks `vite build` with "X is not exported by packages/shared/dist/index.js".
    // Bundling from source sidesteps that entirely and also means the web app
    // never needs a prior `pnpm -r build`. vitest picks these aliases up too.
    alias: {
      '@trading-game/shared': here('../../packages/shared/src/index.ts'),
      '@trading-game/core': here('../../packages/core/src/index.ts'),
      '@trading-game/bot': here('../../packages/bot/src/index.ts'),
    },
  },
  server: {
    port: 3000,
  },
});

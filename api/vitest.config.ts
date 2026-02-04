import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@trading-game/core': path.resolve(__dirname, '../packages/core/src/index.ts'),
      '@trading-game/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
      '@trading-game/bot': path.resolve(__dirname, '../packages/bot/src/index.ts'),
    },
  },
  test: {
    globals: true,
  },
});

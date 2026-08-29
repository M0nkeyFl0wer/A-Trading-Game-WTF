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
    // Runs before every test file: redirects DB_PATH to a temp file and sets
    // PORT=0 / HOST=127.0.0.1 so the suite can never touch api/data/game.db
    // or clash with a running dev server (issue #8).
    setupFiles: ['./tests/setup.ts'],
  },
});

import { defineConfig } from 'vitest/config';

// The Studio's pure-function suite lives in test/*.test.js. The methodology CLI
// tests under test/cli/ use the node:test runner (run via `npm test`), so they are
// excluded here to keep the two runners from tripping over each other.
export default defineConfig({
  test: {
    include: ['test/*.test.js'],
    exclude: ['test/cli/**', 'node_modules/**'],
  },
});

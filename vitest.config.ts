import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { 'cloudflare:sockets': '/test/helpers/cf-sockets.ts' } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 20000,
  },
});

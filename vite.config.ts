/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // The sync API lives in the Worker; run `npm run dev:worker` beside
    // `npm run dev` and the app talks to it transparently.
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    // vi.fn() state (calls, queued mockResolvedValueOnce values) is reset
    // before every test; since vitest 3, restoreAllMocks alone no longer does.
    mockReset: true,
  },
});

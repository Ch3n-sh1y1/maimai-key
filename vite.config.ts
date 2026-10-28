import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'chrome120',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});

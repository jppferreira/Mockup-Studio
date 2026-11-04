import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version: string };
const appVersion = pkg.version;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-app-version',
      transformIndexHtml(html) {
        return html.replaceAll('%APP_VERSION%', appVersion);
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  base: './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: { port: 5173, strictPort: true },
});

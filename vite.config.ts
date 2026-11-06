import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version: string };
const appVersion = pkg.version;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  const gatePassword = env.SITE_GATE_PASSWORD ?? '';
  const gateHash = gatePassword
    ? createHash('sha256').update(gatePassword).digest('hex')
    : '';

  return {
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
      __SITE_GATE_SHA256__: JSON.stringify(gateHash),
    },
    base: './',
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'shared'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api/figma': {
          target: 'https://api.figma.com',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/api\/figma/, '/v1'),
        },
      },
    },
  };
});

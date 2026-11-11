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
      __DISTRIBUTION_CHANNEL__: JSON.stringify(env.MOCKUP_DISTRIBUTION || 'web'),
    },
    base: './',
    // Free starter GLBs are imported with `?url` from src/assets/device-models.
    assetsInclude: ['**/*.glb'],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'shared'),
      },
    },
    build: {
      // Keep heavy studio chunks out of the dashboard cold-load preload set.
      modulePreload: {
        resolveDependencies(filename, deps) {
          return deps.filter((dep) => !/(?:^|\/)(?:three|video-export|mesh-loaders|DeviceCanvas|AnimationPresetsPanel)-/.test(dep));
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three') || id.includes('node_modules/@react-three') || id.includes('node_modules/three-stdlib')) {
              return 'three';
            }
            if (
              id.includes('node_modules/mp4-muxer')
              || id.includes('node_modules/webm-muxer')
              || id.includes('node_modules/gifenc')
              || id.includes('node_modules/mediabunny')
            ) {
              return 'video-export';
            }
            if (id.includes('/src/lib/videoExport.ts') || id.includes('/src/lib/videoExport.js')) {
              return 'video-export';
            }
            return undefined;
          },
        },
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

import { createHash } from 'node:crypto';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // .env* values are not on process.env for this config file unless loaded.
  const env = loadEnv(mode, path.resolve(__dirname), '');
  // GitHub Pages project site: VITE_SITE_BASE=/repo-name/ in .env.production
  const base = env.VITE_SITE_BASE || process.env.VITE_SITE_BASE || '/';
  // Launch gate: plaintext stays in env; only the SHA-256 hash is baked into the bundle.
  // Prefer SITE_PASSWORD; SITE_GATE_PASSWORD is accepted as an alias.
  const gatePassword = (env.SITE_PASSWORD || env.SITE_GATE_PASSWORD || '').trim();
  const gateHash = gatePassword
    ? createHash('sha256').update(gatePassword).digest('hex')
    : '';

  return {
    plugins: [react()],
    base,
    define: {
      __WEBSITE_GATE_SHA256__: JSON.stringify(gateHash),
    },
    root: path.resolve(__dirname),
    publicDir: path.resolve(__dirname, 'public'),
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared'),
        react: path.resolve(__dirname, '../node_modules/react'),
        'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
        'react-router': path.resolve(__dirname, '../node_modules/react-router'),
        'react-router-dom': path.resolve(__dirname, '../node_modules/react-router-dom'),
        'lucide-react': path.resolve(__dirname, '../node_modules/lucide-react'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5180,
      strictPort: true,
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
    },
  };
});


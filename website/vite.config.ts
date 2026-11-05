import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // .env* values are not on process.env for this config file unless loaded.
  const env = loadEnv(mode, path.resolve(__dirname), '');
  // GitHub Pages project site: VITE_SITE_BASE=/repo-name/ in .env.production
  const base = env.VITE_SITE_BASE || process.env.VITE_SITE_BASE || '/';

  return {
    plugins: [react()],
    base,
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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const appVersion = (
  JSON.parse(readFileSync(at('./package.json'), 'utf8')) as {
    version: string;
  }
).version;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  resolve: {
    dedupe: ['react', 'react-dom', 'zustand'],
    alias: {
      '@': at('./src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/firebase/firestore') ||
            id.includes('node_modules/@firebase/firestore')
          )
            return 'firestore';
          if (
            id.includes('node_modules/firebase/auth') ||
            id.includes('node_modules/@firebase/auth')
          )
            return 'auth';
          if (id.includes('node_modules/jspdf')) return 'pdf';
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/')
          )
            return 'react';
        },
      },
    },
  },
});

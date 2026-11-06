import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  build: { outDir: 'dist/client' },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.API_PORT || 3001}`,
    },
  },
});

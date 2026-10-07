import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/api': 'http://localhost:7777',
      '/ws': { target: 'ws://localhost:7777', ws: true },
    },
  },
});

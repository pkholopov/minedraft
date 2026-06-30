import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'textures',
  base: '/minedraft/',
  build: {
    outDir: 'dist',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});

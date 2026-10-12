import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {defineConfig} from 'vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {alias: {'@': path.resolve(import.meta.dirname, '.')}},
  build: {
    assetsDir: 'PassCard_Generator_assets/bundles',
    rollupOptions: {input: path.resolve(import.meta.dirname, 'PassCard_Generator.html')},
  },
});

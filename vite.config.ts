import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Base relativa: funciona igual en Firebase Hosting, Netlify o GitHub Pages
  // (incluido un repo servido en /usuario.github.io/ironloop/).
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Firebase pesa; separarlo evita bloquear el primer render.
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase') || id.includes('@firebase')) return 'firebase';
            if (id.includes('react')) return 'react';
          }
          return undefined;
        },
      },
    },
  },
});

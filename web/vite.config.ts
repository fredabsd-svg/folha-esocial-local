import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Caminho real da pasta (evita erro quando a pasta está em local redirecionado/virtualizado do Windows).
const raiz = realpathSync.native(path.dirname(fileURLToPath(import.meta.url)));

// Em desenvolvimento, a interface (5173) encaminha /api ao serviço local (5178).
export default defineConfig({
  root: raiz,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:5178', changeOrigin: false } },
  },
  build: { outDir: path.join(raiz, 'dist'), emptyOutDir: true, sourcemap: false },
});

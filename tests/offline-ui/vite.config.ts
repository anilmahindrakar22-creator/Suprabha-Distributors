import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({ root: resolve('tests/offline-ui'), publicDir: resolve('public'), plugins: [react()],
  resolve: { alias: { '@': resolve('.') } },
  server: { host: '127.0.0.1', port: 3110, strictPort: true, fs: { allow: [resolve('.')] } },
});

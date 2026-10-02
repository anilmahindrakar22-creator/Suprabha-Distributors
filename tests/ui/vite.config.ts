import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';

// Isolated component test server. No production routes, credentials or auth bypass.
export default defineConfig({ root: resolve('tests/ui'), plugins: [react()], define: { 'process.env': '{}' }, resolve: { alias: { '@': resolve('.'), 'next/image': 'vinext/shims/image' } }, css: { postcss: { plugins: [tailwindcss()] } }, server: { host: '127.0.0.1', port: 3100, strictPort: true, fs: { allow: [resolve('.')] } } });

import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public/generated-offline', emptyOutDir: true,
    lib: { entry: 'offline/app.ts', formats: ['es'], fileName: () => 'offline-app.js' },
    sourcemap: false,
  },
});

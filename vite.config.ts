import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      fileName: () => `app-router.js`,
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vue'],
    },
  },
})

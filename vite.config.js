import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端构建：输出到 dist/，Electron 与 Web Admin 都加载它。
// dev 时把 /api 代理到本地管理端口（8787），与正式环境同源。
export default defineConfig({
  plugins: [react()],
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});

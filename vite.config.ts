import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // OpenCV.js가 자체적으로 ~10MB. dynamic import로 별도 chunk 분리되어
    // 초기 로딩에는 영향 없음. 경고만 사라지게 한도 올림.
    chunkSizeWarningLimit: 12000,
  },
})

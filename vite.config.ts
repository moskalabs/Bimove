import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // dxf-viewer가 three@0.161을 별도 번들하는 문제 해결
      // 프로젝트 최상위 three@0.184로 통합 (API 호환)
      three: path.resolve(__dirname, 'node_modules/three'),
    },
  },
  build: {
    // OpenCV.js가 자체적으로 ~10MB. dynamic import로 별도 chunk 분리되어
    // 초기 로딩에는 영향 없음. 경고만 사라지게 한도 올림.
    chunkSizeWarningLimit: 12000,
  },
})

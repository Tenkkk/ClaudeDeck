import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The directory layout (src/main, src/preload, src/renderer) matches
// electron-vite's conventional defaults, so no explicit entry config is needed.
//
// `externalizeDepsPlugin` keeps everything in `dependencies` out of the bundle.
// This matters for @anthropic-ai/claude-agent-sdk: it locates and spawns the
// Claude Code executable at runtime, so bundling it would break path resolution.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    build: {
      // 关掉资源内联。Vite 默认把 <4KB 的资源转成 data: URI,而渲染层的 CSP 是
      // default-src 'self',不含 data:,内联的字体会被直接拦掉。宁可多一个文件请求,
      // 也不为此放宽 CSP。
      assetsInlineLimit: 0,
    },
  },
})

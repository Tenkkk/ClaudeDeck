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
  },
})

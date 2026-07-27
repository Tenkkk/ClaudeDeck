import type { DeckApi } from '../../preload/index.js'

declare global {
  interface Window {
    api: DeckApi
  }
}

export {}

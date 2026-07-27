import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.js'
import './fonts.css'
import './styles.css'
import './layout.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

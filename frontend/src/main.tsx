import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are imported here (not via CSS @import) so Vite rewrites their URLs
// and emits the font files into the production build.
import '@alibaba-aero/iranyekan/css/fontiran.css'
import 'vazirmatn/Vazirmatn-font-face.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

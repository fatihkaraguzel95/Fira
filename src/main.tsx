import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyStoredTheme } from './hooks/useTheme'
import { applyStoredShell } from './hooks/useShell'
import { applyStoredPalette } from './hooks/usePalette'
import { applyStoredDisplay } from './hooks/useDisplay'
import { applyStoredLang, getLang, loadLang } from './i18n'
import { initIconSet } from './hooks/useIconSet'
import { installCleanCopy } from './lib/cleanCopy'

// Theme must be on <html> before the first paint, on every page (login included)
applyStoredTheme()
applyStoredShell()
applyStoredPalette()
applyStoredDisplay()
applyStoredLang()
// Copying out of Fira carries the content, not the theme (#55bed0f7).
installCleanCopy()

// Seçili dil Türkçe değilse sözlüğü önce iner (#74d303e2), sonra çizilir.
// The chosen language and, for someone who chose the fine icon set, its drawings: both before the first paint.
void Promise.all([loadLang(getLang()), initIconSet()]).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

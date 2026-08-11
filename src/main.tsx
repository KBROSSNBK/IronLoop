import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles/main.css';
import { registerServiceWorker } from './services/pwa';

/**
 * Si el módulo revienta antes de que React monte (navegador viejo, chunk que
 * no carga…), el usuario vería la pantalla de arranque congelada para siempre.
 * Este handler la sustituye por el error real, que es lo único que permite
 * diagnosticar un fallo en el móvil de otra persona.
 */
function showFatal(message: string) {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.style.opacity = '1';
  boot.style.flexDirection = 'column';
  boot.style.gap = '14px';
  boot.style.padding = '24px';
  boot.style.textAlign = 'center';
  boot.style.fontSize = '13px';
  boot.style.letterSpacing = '0.02em';
  boot.innerHTML =
    '<div style="font-size:22px;letter-spacing:.2em">IRONLOOP</div>' +
    '<div style="color:#f87171;max-width:520px;word-break:break-word">' +
    message.replace(/</g, '&lt;') +
    '</div>' +
    '<div style="color:#64748b;max-width:520px">' +
    navigator.userAgent.replace(/</g, '&lt;') +
    '</div>';
}

window.addEventListener('error', (e) => {
  if (!document.getElementById('root')?.hasChildNodes()) {
    showFatal(e.message || 'Error al cargar el juego');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  if (!document.getElementById('root')?.hasChildNodes()) {
    showFatal(String((e.reason as Error)?.message ?? e.reason ?? 'Error de carga'));
  }
});

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
  registerServiceWorker();
} catch (e) {
  showFatal(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
}

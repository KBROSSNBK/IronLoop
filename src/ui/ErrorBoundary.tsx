import { Component, type ErrorInfo, type ReactNode } from 'react';
import { APP_VERSION } from '../config/env';
import { hardReset } from '../services/pwa';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

/**
 * Red de seguridad: si algo revienta, el jugador ve QUÉ ha pasado y un botón
 * para limpiar caché y service workers, en vez de una pantalla en blanco.
 * Sin esto, un fallo en un móvil concreto es imposible de diagnosticar.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ironloop] error fatal', error, info);
    this.setState({ info: (info.componentStack ?? '').slice(0, 400) });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const report = [
      `Versión: ${APP_VERSION}`,
      `Error: ${error.name}: ${error.message}`,
      `Navegador: ${navigator.userAgent}`,
      `Pantalla: ${window.innerWidth}×${window.innerHeight}`,
      info ? `Componente: ${info.split('\n')[1]?.trim() ?? ''}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return (
      <div className="screen">
        <div className="screen-bg" />
        <div className="logo" style={{ fontSize: 34 }}>
          ALGO FALLÓ
        </div>
        <p className="tagline">
          El juego se ha detenido por un error. Prueba a reiniciar; si vuelve a pasar,
          copia este texto y envíaselo al desarrollador.
        </p>

        <pre
          style={{
            width: 'min(520px, 100%)',
            maxHeight: 200,
            overflow: 'auto',
            textAlign: 'left',
            fontSize: 11,
            lineHeight: 1.5,
            padding: 12,
            color: 'var(--text-dim)',
            background: 'rgba(2,6,14,0.8)',
            border: '1px solid rgba(248,113,113,0.4)',
            whiteSpace: 'pre-wrap',
            userSelect: 'text',
          }}
        >
          {report}
        </pre>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Reintentar
          </button>
          <button className="btn btn-ghost" onClick={() => void hardReset()}>
            Limpiar caché y reiniciar
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard?.writeText(report)}
          >
            Copiar error
          </button>
        </div>
      </div>
    );
  }
}

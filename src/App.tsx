import { useEffect } from 'react';
import { useSessionStore } from './state/useSessionStore';
import { useUiStore } from './state/useUiStore';
import { LoginScreen } from './ui/screens/LoginScreen';
import { LoadingScreen } from './ui/screens/LoadingScreen';
import { GameScreen } from './ui/GameScreen';
import { OrientationHint } from './ui/overlays/OrientationHint';
import { setMuted, setMusicEnabled, unlockAudio } from './services/audio';

export default function App() {
  const phase = useSessionStore((s) => s.phase);
  const error = useSessionStore((s) => s.error);
  const boot = useSessionStore((s) => s.boot);
  const setTouch = useUiStore((s) => s.setTouch);
  const setLandscapeHint = useUiStore((s) => s.setLandscapeHint);
  const muted = useUiStore((s) => s.muted);
  const musicOn = useUiStore((s) => s.musicOn);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Detección de entrada táctil y orientación.
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const apply = () => {
      const touch = coarse.matches || 'ontouchstart' in window;
      setTouch(touch);
      const portrait = window.innerHeight > window.innerWidth;
      setLandscapeHint(touch && portrait);
    };
    apply();
    coarse.addEventListener?.('change', apply);
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      coarse.removeEventListener?.('change', apply);
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, [setTouch, setLandscapeHint]);

  // El audio necesita un gesto del usuario para arrancar.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => setMuted(muted), [muted]);
  useEffect(() => setMusicEnabled(musicOn), [musicOn]);

  return (
    <div className="app">
      <aside className="backdrop-side left">
        <div className="backdrop-title">
          IRON
          <br />
          LOOP
        </div>
        <div className="backdrop-sub">Fábrica cooperativa</div>
      </aside>

      <main className="stage scan">
        {phase === 'boot' && <LoadingScreen label="Arrancando sistemas…" />}
        {phase === 'signedOut' && <LoginScreen />}
        {phase === 'loading' && <LoadingScreen />}
        {phase === 'ready' && <GameScreen />}
        {phase === 'error' && (
          <div className="screen">
            <div className="screen-bg" />
            <div className="logo" style={{ fontSize: 34 }}>
              ERROR
            </div>
            <div className="notice" style={{ borderColor: 'rgba(248,113,113,0.5)' }}>
              {error ?? 'Algo ha fallado al iniciar la partida.'}
            </div>
            <button className="btn btn-primary" onClick={() => location.reload()}>
              Reintentar
            </button>
          </div>
        )}
        <OrientationHint />
      </main>

      <aside className="backdrop-side right">
        <div className="backdrop-sub">Controles</div>
        <div className="backdrop-keys">
          <div>
            <b>WASD</b> Moverse
          </div>
          <div>
            <b>SHIFT</b> Correr
          </div>
          <div>
            <b>E</b> Acción
          </div>
          <div>
            <b>Q</b> Secundaria
          </div>
          <div>
            <b>I U M</b> Paneles
          </div>
          <div>
            <b>ESC</b> Cerrar
          </div>
        </div>
      </aside>
    </div>
  );
}

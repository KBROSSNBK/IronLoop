import { useEffect, useState } from 'react';
import { useSessionStore } from '../../state/useSessionStore';
import { unlockAudio } from '../../services/audio';

const FEATURES = [
  '🏭 Fábrica compartida',
  '👥 Hasta 10 operarios',
  '⚙️ Automatización',
  '💰 Dinero individual',
  '🎯 Misiones',
  '🏆 Ranking',
];

export function LoginScreen() {
  const backendKind = useSessionStore((s) => s.backendKind);
  const signInGoogle = useSessionStore((s) => s.signInGoogle);
  const signInGuest = useSessionStore((s) => s.signInGuest);
  const suggestName = useSessionStore((s) => s.suggestName);
  const error = useSessionStore((s) => s.error);
  const [nick, setNick] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (backendKind === 'local') setNick(suggestName());
  }, [backendKind, suggestName]);

  const enterGoogle = async () => {
    unlockAudio();
    setPending(true);
    await signInGoogle();
    setPending(false);
  };

  const enterLocal = async () => {
    unlockAudio();
    setPending(true);
    await signInGuest(nick.trim() || 'Operario');
    setPending(false);
  };

  return (
    <div className="screen">
      <div className="screen-bg" />

      <div>
        <div className="logo">IRONLOOP</div>
        <div className="logo-sub">Fábrica cooperativa</div>
      </div>

      <p className="tagline">
        Entra a una fábrica compartida con otros operarios. Extrae, produce, vende
        y mejora. <b>La fábrica es de todos; el dinero es tuyo.</b>
      </p>

      <div className="feature-row">
        {FEATURES.map((f) => (
          <span className="chip" key={f}>
            {f}
          </span>
        ))}
      </div>

      {/*
        Cualquier backend en la nube entra con Google; sólo el local pide un
        nombre. Comparar contra 'firebase' a secas dejaba la pantalla sin botón
        de acceso el día que apareció un segundo backend en la nube.
      */}
      {backendKind !== 'local' ? (
        <button className="google-btn" onClick={enterGoogle} disabled={pending}>
          <GoogleMark />
          {pending ? 'Conectando…' : 'Entrar con Google'}
        </button>
      ) : (
        <div className="local-box bevel">
          <span className="lbl">Nombre de operario</span>
          <input
            className="name-input"
            value={nick}
            maxLength={20}
            onChange={(e) => setNick(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void enterLocal()}
            placeholder="Operario-1"
          />
          <button className="btn btn-primary" onClick={enterLocal} disabled={pending}>
            {pending ? 'Entrando…' : '▶ Entrar a la fábrica'}
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
            Vuelve con el mismo nombre para recuperar tu progreso.
          </span>
        </div>
      )}

      {backendKind === 'local' && (
        <div className="notice">
          <b>MODO LOCAL ACTIVO.</b> No hay credenciales de Firebase configuradas, así
          que la partida se guarda en este navegador. El multiplayer funciona de
          verdad entre <b>pestañas o ventanas distintas</b>: abre otra pestaña con
          otro nombre y os veréis dentro de la misma fábrica.
          <br />
          Para activar Google Login y multiplayer real entre dispositivos, copia{' '}
          <code>.env.example</code> a <code>.env</code> y rellena tu proyecto Firebase
          (ver <code>FIREBASE_SETUP.md</code>).
        </div>
      )}

      {error && (
        <div className="notice" style={{ borderColor: 'rgba(248,113,113,0.5)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.28-3.14.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

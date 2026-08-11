import { Panel } from './Panel';
import { useUiStore } from '../../state/useUiStore';
import { useSessionStore } from '../../state/useSessionStore';
import { useGameplayStore } from '../../state/useGameplayStore';
import { useState } from 'react';
import { setMuted, setMusicEnabled } from '../../services/audio';
import { APP_VERSION, BACKEND_KIND, isAdminEmail } from '../../config/env';
import { duration } from '../../utils/format';
import { hardReset } from '../../services/pwa';
import { getBackend } from '../../services/backend';
import { createFactoryState, createPlayerState } from '../../game/logic/defaults';

export function SettingsPanel() {
  const muted = useUiStore((s) => s.muted);
  const musicOn = useUiStore((s) => s.musicOn);
  const showFps = useUiStore((s) => s.showFps);
  const setMutedStore = useUiStore((s) => s.setMuted);
  const setMusicStore = useUiStore((s) => s.setMusicOn);
  const toggleFps = useUiStore((s) => s.toggleFps);
  const signOut = useSessionStore((s) => s.signOut);
  const backendLabel = useSessionStore((s) => s.backendLabel);
  const player = useSessionStore((s) => s.player);
  const factory = useSessionStore((s) => s.factory);
  const user = useSessionStore((s) => s.user);
  const fps = useGameplayStore((s) => s.fps);
  const admin = isAdminEmail(user?.email);

  return (
    <Panel
      icon="⚙️"
      title="AJUSTES"
      footer={
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => void signOut()}>
          Cerrar sesión
        </button>
      }
    >
      <div className="section-title">SONIDO</div>
      <Toggle
        label="🔊 Efectos de sonido"
        on={!muted}
        onChange={(v) => {
          setMutedStore(!v);
          setMuted(!v);
        }}
      />
      <Toggle
        label="🎵 Música ambiente"
        on={musicOn}
        onChange={(v) => {
          setMusicStore(v);
          setMusicEnabled(v);
        }}
      />

      <div className="section-title">RENDIMIENTO</div>
      <Toggle label="📊 Mostrar FPS" on={showFps} onChange={toggleFps} />
      <div className="card" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        FPS actuales: <b className="mono-num">{fps}</b>
      </div>

      <div className="section-title">CONTROLES</div>
      <div className="card" style={{ fontSize: 12.5, display: 'grid', gap: 4 }}>
        <span>
          <b>WASD / Flechas</b> — moverse
        </span>
        <span>
          <b>Shift</b> — correr (gasta estamina)
        </span>
        <span>
          <b>E / Espacio</b> — acción principal (mantener para repetir)
        </span>
        <span>
          <b>Q</b> — acción secundaria
        </span>
        <span>
          <b>I U M F C R</b> — paneles · <b>Esc</b> — cerrar
        </span>
      </div>

      <div className="section-title">SOLUCIÓN DE PROBLEMAS</div>
      <div className="card" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Si el juego se queda en una versión antigua o no arranca bien en el móvil,
        esto borra la caché y el service worker y vuelve a cargarlo todo limpio.
        No afecta a tu progreso, que vive en el servidor.
      </div>
      <button className="btn btn-ghost" onClick={() => void hardReset()}>
        🧹 Limpiar caché y recargar
      </button>

      {admin && <AdminSection />}

      <div className="section-title">SESIÓN</div>
      <div className="card" style={{ fontSize: 12, color: 'var(--text-dim)', display: 'grid', gap: 3 }}>
        <span>
          Backend: <b style={{ color: 'var(--cyan-soft)' }}>{backendLabel}</b> ({BACKEND_KIND})
        </span>
        <span>Fábrica: {factory?.name ?? '—'}</span>
        <span>Tiempo jugado: {duration(player?.stats.playtime ?? 0)}</span>
        <span>Versión: {APP_VERSION}</span>
      </div>
    </Panel>
  );
}

/**
 * Panel de administración. Sólo se pinta para los correos de VITE_ADMIN_EMAILS,
 * pero quien autoriza de verdad son las Security Rules (función `isAdmin`):
 * si otro usuario forzara este panel, Firestore rechazaría la escritura.
 */
function AdminSection() {
  const player = useSessionStore((s) => s.player);
  const factory = useSessionStore((s) => s.factory);
  const user = useSessionStore((s) => s.user);
  const pushToast = useUiStore((s) => s.pushToast);
  const [confirming, setConfirming] = useState<'factory' | 'player' | null>(null);

  if (!player || !factory) return null;

  const run = async (what: 'factory' | 'player') => {
    const b = await getBackend();
    try {
      if (what === 'factory') {
        const fresh = createFactoryState(factory.id, 1);
        // `resetAt` es la señal: cada jugador pondrá su progreso a cero la
        // próxima vez que entre (ver opApplyFactoryReset).
        await b.debugPatchFactory?.(factory.id, {
          ...fresh,
          name: factory.name,
          createdAt: factory.createdAt,
          playerCount: factory.playerCount,
          resetAt: Date.now(),
        });
        pushToast({
          title: 'FÁBRICA REINICIADA',
          body: 'Todos los jugadores empezarán de cero.',
          icon: '♻️',
          tone: 'epic',
        });
      } else {
        const fresh = createPlayerState({
          uid: player.uid,
          displayName: player.name,
          photoURL: player.photoURL,
          email: user?.email ?? null,
        });
        await b.debugPatchPlayer?.(player.uid, {
          ...fresh,
          factoryId: player.factoryId,
          appearance: player.appearance,
        });
        pushToast({ title: 'JUGADOR REINICIADO', icon: '♻️', tone: 'epic' });
      }
    } catch (e) {
      pushToast({
        title: 'No se pudo reiniciar',
        body: e instanceof Error ? e.message : 'Permiso denegado',
        icon: '⛔',
        tone: 'bad',
      });
    }
    setConfirming(null);
  };

  return (
    <>
      <div className="section-title">ADMINISTRACIÓN</div>
      <div
        className="card"
        style={{ fontSize: 12, color: 'var(--text-dim)', borderColor: 'rgba(248,113,113,0.35)' }}
      >
        Conectado como <b style={{ color: 'var(--amber-soft)' }}>{user?.email}</b>. Estas
        acciones son irreversibles y el reinicio de fábrica afecta a{' '}
        <b>todos los jugadores</b> de {factory.name}.
      </div>

      {confirming === null ? (
        <div className="debug-grid">
          <button
            className="btn"
            style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
            onClick={() => setConfirming('factory')}
          >
            ♻️ Reiniciar fábrica
          </button>
          <button
            className="btn"
            style={{ borderColor: 'var(--amber)', color: 'var(--amber-soft)' }}
            onClick={() => setConfirming('player')}
          >
            ♻️ Reiniciar mi jugador
          </button>
        </div>
      ) : (
        <div className="card" style={{ borderColor: 'var(--red)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            {confirming === 'factory'
              ? `¿Reiniciar ${factory.name} al nivel 1? Se pierden máquinas, robots y contribución de todos.`
              : '¿Reiniciar tu progreso? Conservas nombre y aspecto.'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              style={{ flex: 1, borderColor: 'var(--red)', color: 'var(--red)' }}
              onClick={() => void run(confirming)}
            >
              Sí, reiniciar
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirming(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className="card"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
      onClick={() => onChange(!on)}
    >
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</span>
      <span
        className="chip"
        style={{
          background: on ? 'rgba(74,222,128,0.18)' : 'rgba(255,255,255,0.06)',
          borderColor: on ? 'var(--green)' : undefined,
          color: on ? 'var(--green)' : 'var(--text-mute)',
        }}
      >
        {on ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

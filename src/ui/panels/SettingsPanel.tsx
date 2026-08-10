import { Panel } from './Panel';
import { useUiStore } from '../../state/useUiStore';
import { useSessionStore } from '../../state/useSessionStore';
import { useGameplayStore } from '../../state/useGameplayStore';
import { setMuted, setMusicEnabled } from '../../services/audio';
import { APP_VERSION, BACKEND_KIND } from '../../config/env';
import { duration } from '../../utils/format';

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
  const fps = useGameplayStore((s) => s.fps);

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

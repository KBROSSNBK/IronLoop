import { useEffect, useRef, useState } from 'react';
import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { APPEARANCE_SLOTS, randomAppearance } from '../../config/cosmetics';
import { deriveStats } from '../../config/balance';
import { drawCharacter } from '../../game/render/character';
import type { ActivityKind, Appearance, FacingDir } from '../../types';

const DIR_ICON: Record<FacingDir, string> = {
  down: '⬇️',
  right: '➡️',
  up: '⬆️',
  left: '⬅️',
};

/** Poses de la vista previa. Un efecto parado no se ve igual que corriendo. */
const ACTS: { id: ActivityKind; icon: string; label: string }[] = [
  { id: 'idle', icon: '🧍', label: 'Quieto' },
  { id: 'walk', icon: '🚶', label: 'Andando' },
  { id: 'run', icon: '🏃', label: 'Corriendo' },
  { id: 'gather', icon: '⛏️', label: 'Picando' },
];

export function CharacterPanel() {
  const player = useSessionStore((s) => s.player);
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);
  const [draft, setDraft] = useState<Appearance | null>(null);
  const [name, setName] = useState('');
  const [dir, setDir] = useState<FacingDir>('down');
  const [act, setAct] = useState<ActivityKind>('walk');

  useEffect(() => {
    if (player && !draft) {
      setDraft(player.appearance);
      setName(player.name);
    }
  }, [player, draft]);

  if (!player || !draft) return null;

  const dirty =
    name.trim() !== player.name ||
    JSON.stringify(draft) !== JSON.stringify(player.appearance);
  const stats = deriveStats(player.upgrades);

  return (
    <Panel
      icon="👷"
      title="PERSONAJE"
      footer={
        <>
          <button
            className="btn btn-ghost"
            onClick={() => setDraft(randomAppearance())}
            disabled={busy}
          >
            🎲 Aleatorio
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy || !dirty}
            onClick={() =>
              void op('setAppearance', { appearance: draft, name: name.trim() })
            }
          >
            Guardar
          </button>
        </>
      }
    >
      <Preview appearance={draft} dir={dir} act={act} />

      {/* Girar y probar la animación: los efectos y el perfil sólo se
          aprecian moviéndose y desde el ángulo correcto. */}
      <div className="preview-ctl">
        {(['down', 'right', 'up', 'left'] as FacingDir[]).map((d) => (
          <button key={d} className="mode-btn" data-on={dir === d} onClick={() => setDir(d)}>
            {DIR_ICON[d]}
          </button>
        ))}
        <span className="sep" />
        {ACTS.map((a) => (
          <button
            key={a.id}
            className="mode-btn"
            data-on={act === a.id}
            title={a.label}
            onClick={() => setAct(a.id)}
          >
            {a.icon}
          </button>
        ))}
      </div>

      <div className="section-title">NOMBRE</div>
      <input
        className="name-input"
        value={name}
        maxLength={20}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="section-title">ASPECTO</div>
      <div className="appearance-grid">
        {APPEARANCE_SLOTS.map((slot) => (
          <div className="slot-row" key={slot.key}>
            <span style={{ fontSize: 11.5, color: 'var(--text-mute)', letterSpacing: '0.1em' }}>
              {slot.label.toUpperCase()}
            </span>
            <div className="opts">
              {slot.options.map((o) => {
                const on = draft[slot.key] === o.id;
                if (slot.kind === 'color') {
                  return (
                    <button
                      key={o.id}
                      className="opt-swatch"
                      data-on={on}
                      style={{ background: o.id }}
                      title={o.name + (o.premium ? ' (cosmético futuro)' : '')}
                      onClick={() => setDraft({ ...draft, [slot.key]: o.id })}
                    />
                  );
                }
                return (
                  <button
                    key={o.id}
                    className="opt-chip"
                    data-on={on}
                    title={o.name}
                    onClick={() => setDraft({ ...draft, [slot.key]: o.id })}
                  >
                    {o.icon && <i className="ico">{o.icon}</i>}
                    {o.name}
                    {o.premium ? ' ✦' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="section-title">ESTADÍSTICAS ACTUALES</div>
      <div className="card">
        <Stat label="Velocidad" value={`${Math.round(stats.speed)} px/s`} />
        <Stat label="Estamina máxima" value={String(Math.round(stats.maxStamina))} />
        <Stat label="Regeneración" value={`${stats.staminaRegen.toFixed(2)}/s`} />
        <Stat label="Huecos de inventario" value={String(stats.inventorySlots)} />
        <Stat label="Unidades por acción" value={String(stats.gatherAmount)} />
        <Stat label="Precio de venta" value={`×${stats.sellMultiplier.toFixed(2)}`} />
        <Stat label="Hallazgo raro" value={`${(stats.rareChance * 100).toFixed(1)}%`} />
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="item-row" style={{ padding: '3px 0' }}>
      <span className="name" style={{ fontWeight: 600, fontSize: 13 }}>
        {label}
      </span>
      <span className="val mono-num">{value}</span>
    </div>
  );
}

function Preview({
  appearance,
  dir,
  act,
}: {
  appearance: Appearance;
  dir: FacingDir;
  act: ActivityKind;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 150 * dpr;
    canvas.height = 150 * dpr;

    const render = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, 150, 150);
      ctx.save();
      ctx.translate(75, 100);
      ctx.scale(1.9, 1.9);
      drawCharacter(ctx, {
        x: 0,
        y: 0,
        dir,
        act,
        t: t / 1000,
        appearance,
        name: '',
        level: 1,
        isLocal: true,
      });
      ctx.restore();
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [appearance, dir, act]);

  return (
    <div className="char-preview">
      <canvas ref={ref} style={{ width: 150, height: 150 }} />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { APPEARANCE_SLOTS, randomAppearance } from '../../config/cosmetics';
import { deriveStats } from '../../config/balance';
import { drawCharacter } from '../../game/render/character';
import type { ActivityKind, Appearance, FacingDir } from '../../types';

/** Poses de la vista previa. Un efecto parado no se ve igual que corriendo. */
const ACTS: { id: ActivityKind; icon: string; label: string }[] = [
  { id: 'idle', icon: '🧍', label: 'Quieto' },
  { id: 'walk', icon: '🚶', label: 'Andando' },
  { id: 'run', icon: '🏃', label: 'Corriendo' },
  { id: 'gather', icon: '⛏️', label: 'Picando' },
];

/** Giro del muñeco, en el orden en el que gira al pulsar la flecha. */
const TURN: FacingDir[] = ['down', 'right', 'up', 'left'];

/**
 * VESTIDOR POR CATEGORÍAS.
 *
 * Antes eran nueve filas de fichas una detrás de otra: para cambiar el pelo
 * había que buscar entre colores de ropa y auras, y el muñeco quedaba tan
 * arriba que ni se veía el cambio. Ahora funciona como cualquier vestidor
 * decente — el personaje SIEMPRE a la vista, una pestaña por parte del cuerpo
 * y dentro sólo lo de esa parte, con su color al lado.
 */
const CATEGORIES: { id: string; label: string; icon: string; slots: string[] }[] = [
  { id: 'cuerpo', label: 'Cuerpo', icon: '🧑', slots: ['body'] },
  { id: 'pelo', label: 'Pelo', icon: '💇', slots: ['hair', 'hairColor'] },
  { id: 'ropa', label: 'Ropa', icon: '👕', slots: ['outfit', 'outfitColor', 'accent'] },
  { id: 'cabeza', label: 'Cabeza', icon: '🎩', slots: ['helmet'] },
  { id: 'calzado', label: 'Calzado', icon: '👟', slots: ['shoes'] },
  { id: 'efecto', label: 'Efecto', icon: '✨', slots: ['aura'] },
];

const SLOT_MAP = Object.fromEntries(APPEARANCE_SLOTS.map((s) => [s.key, s]));

export function CharacterPanel() {
  const player = useSessionStore((s) => s.player);
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);
  const [draft, setDraft] = useState<Appearance | null>(null);
  const [name, setName] = useState('');
  const [dir, setDir] = useState<FacingDir>('down');
  const [act, setAct] = useState<ActivityKind>('walk');
  const [cat, setCat] = useState(CATEGORIES[0].id);

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
  const activa = CATEGORIES.find((c) => c.id === cat) ?? CATEGORIES[0];
  const girar = (paso: number) =>
    setDir(TURN[(TURN.indexOf(dir) + paso + TURN.length) % TURN.length]);

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
            className="btn btn-ghost"
            onClick={() => setDraft(player.appearance)}
            disabled={busy || !dirty}
            title="Vuelve a como estabas"
          >
            ↺
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            disabled={busy || !dirty}
            onClick={() =>
              void op('setAppearance', { appearance: draft, name: name.trim() })
            }
          >
            {dirty ? 'Guardar cambios' : 'Guardado'}
          </button>
        </>
      }
    >
      <div className="dressing">
        {/* ── Escaparate: el muñeco, girándolo y en movimiento ── */}
        <div className="dressing-stage">
          <button className="turn" onClick={() => girar(-1)} title="Girar a la izquierda">
            ‹
          </button>
          <Preview appearance={draft} dir={dir} act={act} />
          <button className="turn" onClick={() => girar(1)} title="Girar a la derecha">
            ›
          </button>
        </div>
        <div className="pose-row">
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

        {/* ── Vestidor: una pestaña por parte, y dentro sólo lo suyo ── */}
        <div className="wardrobe">
          <div className="cat-rail">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className="cat-btn"
                data-on={cat === c.id}
                onClick={() => setCat(c.id)}
              >
                <i className="ico">{c.icon}</i>
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          <div className="cat-body">
            {activa.slots.map((key) => {
              const slot = SLOT_MAP[key];
              if (!slot) return null;
              const esColor = slot.kind === 'color';
              return (
                <div className="wardrobe-slot" key={key}>
                  <div className="wardrobe-label">{slot.label}</div>
                  <div className={esColor ? 'tone-row' : 'tile-grid'}>
                    {slot.options.map((o) => {
                      const on = draft[slot.key] === o.id;
                      const pick = () => setDraft({ ...draft, [slot.key]: o.id });
                      if (esColor) {
                        return (
                          <button
                            key={o.id}
                            className="tone"
                            data-on={on}
                            style={{ background: o.id }}
                            title={o.name + (o.premium ? ' ✦' : '')}
                            onClick={pick}
                          />
                        );
                      }
                      return (
                        <button key={o.id} className="tile" data-on={on} onClick={pick}>
                          <i className="ico">{o.icon ?? '•'}</i>
                          <span className="nm">{o.name}</span>
                          {o.premium && <b className="pin">✦</b>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="section-title">NOMBRE</div>
      <input
        className="name-input"
        value={name}
        maxLength={20}
        onChange={(e) => setName(e.target.value)}
      />

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
    const SIZE = 168;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;

    const render = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.save();
      ctx.translate(SIZE / 2, SIZE * 0.7);
      ctx.scale(2.3, 2.3);
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
      <canvas ref={ref} style={{ width: 168, height: 168 }} />
    </div>
  );
}

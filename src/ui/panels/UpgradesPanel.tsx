import { useState } from 'react';
import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { UPGRADE_LIST, upgradeCost } from '../../config/upgrades';
import { ROBOT_CONTRIB_RATIO, robotCarry, robotCost, robotRate } from '../../config/robots';
import { getMachine } from '../../config/machines';
import { getItem } from '../../config/items';
import { robotStatuses } from '../../game/logic/robots';
import {
  DEFAULT_WEAPON,
  WEAPONS,
  WEAPON_STAT_LIST,
  deriveWeapon,
  weaponStatCost,
} from '../../config/weapons';
import { compact, moneyExact } from '../../utils/format';

type Tab = 'mejoras' | 'armas' | 'robots';

/**
 * TALLER: mejoras personales y flota de robots. Es el único sitio donde se
 * compra automatización, para que el jugador sepa siempre dónde mirar.
 */
export function UpgradesPanel() {
  const player = useSessionStore((s) => s.player);
  const factory = useSessionStore((s) => s.factory);
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);
  const [tab, setTab] = useState<Tab>('mejoras');

  if (!player || !factory) return null;

  return (
    <Panel
      icon="🛠️"
      title="TALLER"
      footer={
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Tu dinero</span>
          <span className="mono-num" style={{ fontSize: 18, fontWeight: 800, color: 'var(--amber-soft)' }}>
            {moneyExact(player.money)}
          </span>
        </div>
      }
    >
      <div className="rank-tabs">
        <button className="rank-tab bevel-sm" data-on={tab === 'mejoras'} onClick={() => setTab('mejoras')}>
          🧰 Personaje
        </button>
        <button className="rank-tab bevel-sm" data-on={tab === 'armas'} onClick={() => setTab('armas')}>
          🔫 Armas
        </button>
        <button className="rank-tab bevel-sm" data-on={tab === 'robots'} onClick={() => setTab('robots')}>
          🤖 Robots
        </button>
      </div>

      {tab === 'mejoras' ? (
        <>
          <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Estas mejoras son <b>sólo tuyas</b>. Además, un <b>35%</b> de lo que gastas
            alimenta el progreso de la fábrica compartida.
          </div>

          {UPGRADE_LIST.map((def) => {
            const level = player.upgrades[def.id] ?? 0;
            const maxed = level >= def.maxLevel;
            const cost = upgradeCost(def, level);
            const locked = player.level < def.unlockLevel;
            const afford = player.money >= cost;
            return (
              <div
                className="upg-card"
                key={def.id}
                data-locked={locked}
                style={{ ['--upg-color' as string]: def.accent }}
              >
                <div className="upg-icon">{def.icon}</div>
                <div className="upg-main">
                  <div className="upg-name">
                    {def.name} <span style={{ color: 'var(--text-mute)' }}>Nv.{level}</span>
                  </div>
                  <div className="upg-effect">
                    {locked ? `🔒 Requiere nivel ${def.unlockLevel}` : def.effect(level) || def.desc}
                  </div>
                  <div className="upg-pips">
                    {Array.from({ length: Math.min(def.maxLevel, 15) }, (_, i) => (
                      <i key={i} className={i < Math.min(level, 15) ? 'on' : ''} />
                    ))}
                  </div>
                </div>
                <button
                  className={`upg-buy${maxed ? ' max' : ''}`}
                  disabled={busy || maxed || locked || !afford}
                  onClick={() => void op('buyUpgrade', { upgradeId: def.id })}
                >
                  {maxed ? 'MÁX' : locked ? '🔒' : moneyExact(cost)}
                </button>
              </div>
            );
          })}
        </>
      ) : tab === 'armas' ? (
        <WeaponsTab />
      ) : (
        <>
          <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Los robots <b>no extraen</b>: eso sigue siendo cosa vuestra. Lo que hacen es
            el paseo aburrido, moviendo material de una máquina a la siguiente por las
            cintas, incluso con la fábrica vacía. Son <b>compartidos</b>: quien los paga
            beneficia a todos, y el <b>{Math.round(ROBOT_CONTRIB_RATIO * 100)}%</b> del
            coste va al núcleo.
          </div>

          {robotStatuses(factory).map(({ def, state, owned, available, status }) => {
            const cost = robotCost(def, state.level);
            const maxed = state.level >= def.maxLevel;
            const afford = player.money >= cost;
            const from = getMachine(def.from);
            const to = getMachine(def.to);
            const item = getItem(def.item);

            const statusText: Record<typeof status, string> = {
              locked: `🔒 Requiere fábrica nivel ${def.unlockFactoryLevel}`,
              idle: 'Sin desplegar',
              working: '🟢 Transportando',
              'no-source': '⏸ Esperando material en origen',
              'dest-full': '⚠️ Entrada de destino llena',
            };

            return (
              <div
                className="machine-card"
                key={def.id}
                style={{ ['--m-color' as string]: def.accent }}
              >
                <div className="head">
                  <span style={{ fontSize: 18 }}>{def.icon}</span>
                  <span className="nm">{def.name}</span>
                  {owned && <span className="chip">Nv.{state.level}</span>}
                </div>

                <div className="recipe">
                  {from.icon} {from.short} → {item.icon} → {to.icon} {to.short}
                </div>
                <div className="stat">{def.desc}</div>
                <div className="stat">{statusText[status]}</div>

                {owned && (
                  <>
                    <div className="stat">
                      Lleva <b className="mono-num">{robotCarry(def, state.level)}</b> {item.name} por
                      viaje · <b className="mono-num">{robotRate(def, state.level)}</b>/min
                    </div>
                    <div className="stat">
                      Transportado en total: <b className="mono-num">{compact(state.moved)}</b>
                    </div>
                  </>
                )}

                <button
                  className={`upg-buy${maxed ? ' max' : ''}`}
                  style={{ alignSelf: 'flex-start' }}
                  disabled={busy || !available || maxed || !afford}
                  onClick={() => void op('buyRobot', { robotId: def.id })}
                >
                  {!available
                    ? '🔒'
                    : maxed
                      ? 'NIVEL MÁX'
                      : `${owned ? 'MEJORAR' : 'DESPLEGAR'} · ${moneyExact(cost)}`}
                </button>

                {available && !maxed && (
                  <div className="stat" style={{ marginTop: -2 }}>
                    Al mejorar pasa a llevar{' '}
                    <b className="mono-num">{robotCarry(def, state.level + 1)}</b> por viaje (
                    {robotRate(def, state.level + 1)}/min) · aporta{' '}
                    {compact(Math.round(cost * ROBOT_CONTRIB_RATIO))} al núcleo
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </Panel>
  );
}

/**
 * Armas automáticas. Disparan solas a lo que se acerque; lo que el jugador
 * decide aquí es en qué invertir y qué arma llevar equipada.
 */
function WeaponsTab() {
  const player = useSessionStore((s) => s.player)!;
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);

  const weapon = { ...DEFAULT_WEAPON, ...(player.weapon ?? {}) };
  const derived = deriveWeapon(weapon);

  return (
    <>
      <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Tu arma dispara <b>sola</b> a lo que entre en su alcance mientras trabajas.
        Las mejoras se aplican al arma que lleves equipada, sea cual sea.
      </div>

      <div className="weapon-hero bevel-sm">
        <div className="ico">{derived.def.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nm">{derived.def.name}</div>
          <div className="stat">{derived.def.desc}</div>
        </div>
      </div>

      <div className="weapon-stats">
        <Metric label="DPS" value={derived.dps.toFixed(1)} accent="var(--red)" />
        <Metric label="Daño" value={derived.damage.toFixed(1)} accent="var(--amber-soft)" />
        <Metric
          label="Cadencia"
          value={`${(1000 / derived.fireRateMs).toFixed(1)}/s`}
          accent="var(--blue)"
        />
        <Metric label="Proyectiles" value={String(derived.projectiles)} accent="var(--lime)" />
        <Metric label="Alcance" value={`${derived.range} px`} accent="var(--violet)" />
        <Metric label="Bajas" value={compact(player.stats.kills ?? 0)} accent="var(--cyan)" />
      </div>

      <div className="section-title">MEJORAS DEL ARMA</div>
      {WEAPON_STAT_LIST.map((def) => {
        const level = weapon[def.id] ?? 0;
        const maxed = level >= def.maxLevel;
        const cost = weaponStatCost(def, level);
        const afford = player.money >= cost;
        return (
          <div
            className="upg-card"
            key={def.id}
            style={{ ['--upg-color' as string]: def.accent }}
          >
            <div className="upg-icon">{def.icon}</div>
            <div className="upg-main">
              <div className="upg-name">
                {def.name} <span style={{ color: 'var(--text-mute)' }}>Nv.{level}</span>
              </div>
              <div className="upg-effect">{level > 0 ? def.effect(level) : def.desc}</div>
              <div className="upg-pips">
                {Array.from({ length: Math.min(def.maxLevel, 15) }, (_, i) => (
                  <i key={i} className={i < Math.min(level, 15) ? 'on' : ''} />
                ))}
              </div>
            </div>
            <button
              className={`upg-buy${maxed ? ' max' : ''}`}
              disabled={busy || maxed || !afford}
              onClick={() => void op('buyWeaponStat', { stat: def.id })}
            >
              {maxed ? 'MÁX' : moneyExact(cost)}
            </button>
          </div>
        );
      })}

      <div className="section-title">ARSENAL</div>
      {WEAPONS.map((w) => {
        const owned = weapon.owned.includes(w.id);
        const equipped = weapon.type === w.id;
        const locked = player.level < w.unlockLevel;
        const afford = player.money >= w.cost;
        const preview = deriveWeapon({ ...weapon, type: w.id });
        return (
          <div
            className="upg-card"
            key={w.id}
            data-locked={locked && !owned}
            style={{ ['--upg-color' as string]: w.color }}
          >
            <div className="upg-icon">{w.icon}</div>
            <div className="upg-main">
              <div className="upg-name">
                {w.name}
                {equipped && <span style={{ color: 'var(--green)' }}> · EQUIPADA</span>}
              </div>
              <div className="upg-effect">{w.desc}</div>
              <div className="upg-effect" style={{ color: 'var(--text-mute)' }}>
                {preview.dps.toFixed(0)} DPS · {preview.projectiles} proyectil
                {preview.projectiles === 1 ? '' : 'es'} · {w.range} px
              </div>
            </div>
            <button
              className={`upg-buy${equipped ? ' max' : ''}`}
              disabled={busy || equipped || (!owned && (locked || !afford))}
              onClick={() => void op('buyWeapon', { weaponId: w.id })}
            >
              {equipped
                ? 'EN USO'
                : owned
                  ? 'EQUIPAR'
                  : locked
                    ? `🔒 Nv.${w.unlockLevel}`
                    : moneyExact(w.cost)}
            </button>
          </div>
        );
      })}
    </>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="weapon-metric" style={{ ['--m' as string]: accent }}>
      <span className="l">{label}</span>
      <span className="v mono-num">{value}</span>
    </div>
  );
}

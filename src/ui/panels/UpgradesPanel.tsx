import { useState } from 'react';
import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { UPGRADE_LIST, upgradeCost } from '../../config/upgrades';
import { ROBOT_CONTRIB_RATIO, robotCost, robotRate } from '../../config/robots';
import { getMachine } from '../../config/machines';
import { getItem } from '../../config/items';
import { robotStatuses } from '../../game/logic/robots';
import { compact, moneyExact } from '../../utils/format';

type Tab = 'mejoras' | 'robots';

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
          🧰 Mejoras
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
                      Ritmo: <b className="mono-num">{robotRate(def, state.level)}</b> {item.name}/min
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
                    +{def.ratePerMin} {item.name}/min por nivel · aporta{' '}
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

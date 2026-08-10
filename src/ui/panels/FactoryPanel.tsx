import { useState } from 'react';
import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { getFactoryLevel } from '../../config/factoryLevels';
import { MACHINE_LIST, MACHINE_UPGRADE, machineUpgradeCost } from '../../config/machines';
import { getItem } from '../../config/items';
import { BALANCE } from '../../config/balance';
import { factoryProgress } from '../../game/logic/progression';
import { pendingCycles, settleMachine } from '../../game/logic/production';
import { compact, moneyExact } from '../../utils/format';

const DONATIONS = [100, 500, 2500];

export function FactoryPanel() {
  const player = useSessionStore((s) => s.player);
  const factory = useSessionStore((s) => s.factory);
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);
  const [now] = useState(() => Date.now());
  if (!player || !factory) return null;

  const fp = factoryProgress(factory);
  const def = getFactoryLevel(factory.level);
  const next = getFactoryLevel(factory.level + 1);

  const donatableItems = Object.entries(player.inventory).filter(
    ([id, q]) => q > 0 && getItem(id).contribValue > 0,
  );

  return (
    <Panel icon="🏭" title="FÁBRICA COMPARTIDA">
      <div className="factory-hero bevel-sm">
        <div className="name">{factory.name}</div>
        <div className="lvl">NIVEL {factory.level}</div>
        <div className="title">{def.title}</div>
        <div className="desc">{def.desc}</div>
        <div className="bar" style={{ marginTop: 10, height: 10 }}>
          <i style={{ width: `${fp.ratio * 100}%`, background: 'var(--grad-cyan)' }} />
        </div>
        <div className="mono-num" style={{ fontSize: 11, marginTop: 4, color: 'var(--text-dim)' }}>
          {compact(fp.contribution)} / {compact(fp.needed)} para el nivel {factory.level + 1}
        </div>
        <div style={{ fontSize: 11.5, marginTop: 8, color: 'var(--cyan-soft)' }}>
          Siguiente: <b>{next.title}</b> — {next.unlocks.join(' · ')}
        </div>
      </div>

      <div className="section-title">CONTRIBUIR DINERO</div>
      <div className="contrib-row">
        {DONATIONS.map((amount) => (
          <button
            key={amount}
            className="contrib-btn bevel-sm"
            disabled={busy || player.money < amount}
            onClick={() => void op('contribute', { money: amount })}
          >
            {moneyExact(amount)}
            <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>
              +{compact(Math.round(amount * BALANCE.factory.contribPerMoney))}
            </div>
          </button>
        ))}
      </div>

      <div className="section-title">CONTRIBUIR MATERIALES</div>
      {donatableItems.length === 0 && (
        <div className="empty-note">No llevas materiales que aporten al núcleo.</div>
      )}
      <div className="contrib-row">
        {donatableItems.map(([id, qty]) => {
          const item = getItem(id);
          return (
            <button
              key={id}
              className="contrib-btn bevel-sm"
              disabled={busy}
              onClick={() => void op('contribute', { items: { [id]: qty } })}
            >
              {item.icon} ×{qty}
              <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>
                +{compact(item.contribValue * qty)}
              </div>
            </button>
          );
        })}
      </div>

      <div className="section-title">MAQUINARIA</div>
      {MACHINE_LIST.map((m) => {
        const state = factory.machines[m.id];
        if (!state) return null;
        const locked = factory.level < m.unlockFactoryLevel;
        const settled = settleMachine(state, m.id, factory.level, now);
        const cost = machineUpgradeCost(state.level);
        const maxed = state.level >= MACHINE_UPGRADE.maxLevel;
        return (
          <div className="machine-card" key={m.id} style={{ ['--m-color' as string]: m.accent }}>
            <div className="head">
              <span style={{ fontSize: 18 }}>{m.icon}</span>
              <span className="nm">{m.name}</span>
              <span className="chip">Mk{state.level + 1}</span>
            </div>
            {locked ? (
              <div className="stat">🔒 Se desbloquea con la fábrica a nivel {m.unlockFactoryLevel}</div>
            ) : (
              <>
                <div className="recipe">
                  {Object.entries(m.input)
                    .map(([i, n]) => `${n}× ${getItem(i).icon}`)
                    .join(' + ')}
                  {' → '}
                  {Object.entries(m.output)
                    .map(([i, n]) => `${n}× ${getItem(i).icon}`)
                    .join(' + ')}
                </div>
                <div className="bar">
                  <i style={{ width: `${settled.progress * 100}%`, background: m.accent }} />
                </div>
                <div className="stat">
                  {settled.running
                    ? `Produciendo · ciclo ${(settled.cycleMs / 1000).toFixed(1)}s · ${pendingCycles(settled.state, m.id)} ciclos en cola`
                    : settled.blocked === 'output-full'
                      ? '⚠️ Salida llena: recoge el producto'
                      : '⏸ Sin material: carga la entrada'}
                </div>
                <div className="stat">
                  Producidos en total: <b className="mono-num">{compact(settled.state.cycles)}</b> ciclos
                </div>
              </>
            )}
            <button
              className="upg-buy"
              disabled={busy || locked || maxed || player.money < cost}
              onClick={() => void op('upgradeMachine', { machineId: m.id })}
              style={{ alignSelf: 'flex-start' }}
            >
              {maxed ? 'NIVEL MÁX' : `MEJORAR · ${moneyExact(cost)}`}
            </button>
            {!locked && !maxed && (
              <div className="stat" style={{ marginTop: -2 }}>
                +{Math.round(MACHINE_UPGRADE.speedStep * 100)}% velocidad para <b>todos</b> · aporta{' '}
                {compact(Math.round(cost * MACHINE_UPGRADE.contribPerPurchase))} al núcleo
              </div>
            )}
          </div>
        );
      })}

      <div className="section-title">ESTADÍSTICAS GLOBALES</div>
      <div className="card">
        <div className="item-row">
          <span className="ico">📦</span>
          <span className="name">Unidades producidas</span>
          <span className="val mono-num">{compact(factory.stats.produced)}</span>
        </div>
        <div className="item-row">
          <span className="ico">⛏️</span>
          <span className="name">Material extraído</span>
          <span className="val mono-num">{compact(factory.stats.gathered)}</span>
        </div>
        <div className="item-row">
          <span className="ico">💰</span>
          <span className="name">Mercancía vendida</span>
          <span className="val mono-num">{moneyExact(factory.stats.sold)}</span>
        </div>
        <div className="item-row">
          <span className="ico">🏭</span>
          <span className="name">Contribución total</span>
          <span className="val mono-num">{compact(factory.totalContribution)}</span>
        </div>
      </div>
    </Panel>
  );
}

import { useMemo, useState } from 'react';
import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { BALANCE } from '../../config/balance';
import { compact, moneyExact } from '../../utils/format';
import type { FactoryMember } from '../../types';

type Metric = 'contributed' | 'produced' | 'sold' | 'money' | 'level';

const TABS: { id: Metric; label: string }[] = [
  { id: 'contributed', label: 'Contribución' },
  { id: 'produced', label: 'Producción' },
  { id: 'sold', label: 'Ventas' },
  { id: 'money', label: 'Dinero' },
  { id: 'level', label: 'Nivel' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

export function RankingPanel() {
  const members = useSessionStore((s) => s.members);
  const presence = useSessionStore((s) => s.presence);
  const player = useSessionStore((s) => s.player);
  const factory = useSessionStore((s) => s.factory);
  const [metric, setMetric] = useState<Metric>('contributed');

  const onlineIds = useMemo(
    () => new Set([...presence.map((p) => p.uid), player?.uid].filter(Boolean) as string[]),
    [presence, player],
  );

  const sorted = useMemo(() => {
    const list = [...members];
    // El propio jugador puede no haber llegado aún al listener de miembros.
    if (player && !list.some((m) => m.uid === player.uid)) {
      list.push({
        uid: player.uid,
        name: player.name,
        photoURL: player.photoURL,
        level: player.level,
        contributed: player.stats.contributed,
        produced: player.stats.produced,
        sold: player.stats.sold,
        money: player.money,
        joinedAt: player.createdAt,
        lastSeenAt: Date.now(),
      });
    }
    return list.sort((a, b) => value(b, metric) - value(a, metric));
  }, [members, metric, player]);

  const format = (m: FactoryMember) =>
    metric === 'money'
      ? moneyExact(m.money)
      : metric === 'level'
        ? `Nv. ${m.level}`
        : compact(value(m, metric));

  return (
    <Panel icon="🏆" title="RANKING DE LA FÁBRICA">
      <div className="rank-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="rank-tab bevel-sm"
            data-on={metric === t.id}
            onClick={() => setMetric(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        {factory?.name} · {sorted.length} / {BALANCE.factory.maxPlayers} operarios ·{' '}
        <b style={{ color: 'var(--green)' }}>{onlineIds.size} conectados</b>
      </div>

      {sorted.map((m, i) => (
        <div className="rank-row" key={m.uid} data-me={m.uid === player?.uid}>
          <span className="rank-pos">{MEDALS[i] ?? i + 1}</span>
          <span className="presence-dot" data-on={onlineIds.has(m.uid)} />
          <span className="rank-name">
            {m.name}
            <span style={{ color: 'var(--text-mute)', fontWeight: 600 }}> · Nv.{m.level}</span>
          </span>
          <span className="rank-val mono-num">{format(m)}</span>
        </div>
      ))}

      {sorted.length === 0 && <div className="empty-note">Aún no hay operarios registrados.</div>}

      <div className="section-title">TUS TOTALES</div>
      {player && (
        <div className="card">
          <Row label="Contribución a la fábrica" value={compact(player.stats.contributed)} />
          <Row label="Unidades producidas" value={compact(player.stats.produced)} />
          <Row label="Unidades extraídas" value={compact(player.stats.gathered)} />
          <Row label="Unidades vendidas" value={compact(player.stats.sold)} />
          <Row label="Dinero ganado" value={moneyExact(player.stats.earned)} />
          <Row label="Mejoras compradas" value={String(player.stats.upgradesBought)} />
        </div>
      )}
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="item-row" style={{ padding: '3px 0' }}>
      <span className="name" style={{ fontWeight: 600, fontSize: 13 }}>
        {label}
      </span>
      <span className="val mono-num">{value}</span>
    </div>
  );
}

function value(m: FactoryMember, metric: Metric): number {
  switch (metric) {
    case 'contributed':
      return m.contributed;
    case 'produced':
      return m.produced;
    case 'sold':
      return m.sold;
    case 'money':
      return m.money;
    case 'level':
      return m.level;
  }
}

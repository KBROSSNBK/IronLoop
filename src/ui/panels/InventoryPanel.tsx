import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { getItem, CONSUMABLE_EFFECTS } from '../../config/items';
import { deriveStats } from '../../config/balance';
import { computeSale, inventoryUsed, sellableItems } from '../../game/logic/progression';
import { moneyExact } from '../../utils/format';

export function InventoryPanel() {
  const player = useSessionStore((s) => s.player);
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);
  if (!player) return null;

  const stats = deriveStats(player.upgrades);
  const used = inventoryUsed(player.inventory);
  const slots = stats.inventorySlots;
  const entries = Object.entries(player.inventory).filter(([, q]) => q > 0);
  const sale = computeSale(player.inventory, sellableItems(player.inventory), player.upgrades);

  const cells = Array.from({ length: Math.max(slots, 10) }, (_, i) => i);
  const flat: { id: string; qty: number }[] = [];
  for (const [id, qty] of entries) flat.push({ id, qty });

  return (
    <Panel
      icon="🎒"
      title="INVENTARIO"
      footer={
        <>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)' }}>
            Valor de venta total
            <div className="mono-num" style={{ fontSize: 17, fontWeight: 800, color: 'var(--amber-soft)' }}>
              {moneyExact(sale.money)}
            </div>
          </div>
          <button
            className="btn btn-amber"
            disabled={busy || sale.units === 0}
            onClick={() => void op('sell')}
            title="Puedes vender desde aquí o en el Muelle de Carga"
          >
            💰 Vender todo
          </button>
        </>
      }
    >
      <div className="hud-meter-label">
        <span>CAPACIDAD</span>
        <span className="mono-num">
          {used} / {slots}
        </span>
      </div>
      <div className="bar">
        <i
          style={{
            width: `${Math.min(1, used / slots) * 100}%`,
            background: used >= slots ? 'linear-gradient(135deg,#f87171,#dc2626)' : 'var(--grad-cyan)',
          }}
        />
      </div>

      <div className="inv-grid">
        {cells.map((i) => {
          const item = flat[i];
          if (i >= slots) return <div key={i} className="inv-slot locked" />;
          if (!item) return <div key={i} className="inv-slot empty">·</div>;
          const def = getItem(item.id);
          return (
            <div
              key={i}
              className="inv-slot filled"
              style={{ ['--slot-color' as string]: def.color }}
              title={`${def.name} — ${def.desc}`}
            >
              {def.icon}
              <span className="qty">{item.qty}</span>
            </div>
          );
        })}
      </div>

      <div className="section-title">CONTENIDO</div>
      {entries.length === 0 && (
        <div className="empty-note">
          Mochila vacía.
          <br />
          Ve al <b>YACIMIENTO</b> y extrae mineral.
        </div>
      )}
      {entries.map(([id, qty]) => {
        const def = getItem(id);
        const usable = !!CONSUMABLE_EFFECTS[id];
        return (
          <div className="card item-row" key={id}>
            <span className="ico">{def.icon}</span>
            <div className="name">
              {def.name}
              <div className="meta">{def.desc}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="val mono-num">×{qty}</div>
              {def.sellPrice > 0 && (
                <div className="meta">{moneyExact(def.sellPrice * qty * stats.sellMultiplier)}</div>
              )}
            </div>
            {usable && (
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void op('useItem', { itemId: id })}
              >
                Usar
              </button>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

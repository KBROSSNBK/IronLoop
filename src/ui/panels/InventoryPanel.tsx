import { useState } from 'react';
import { Panel } from './Panel';
import { QuantityDialog, type QuantityRequest } from './QuantityDialog';
import { useSessionStore } from '../../state/useSessionStore';
import { useGameplayStore } from '../../state/useGameplayStore';
import { getItem, CONSUMABLE_EFFECTS } from '../../config/items';
import { deriveStats, BALANCE } from '../../config/balance';
import { computeSale, inventoryUsed } from '../../game/logic/progression';
import { moneyExact } from '../../utils/format';

export function InventoryPanel() {
  const player = useSessionStore((s) => s.player);
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);
  const px = useGameplayStore((s) => s.x);
  const py = useGameplayStore((s) => s.y);
  const inSellArea = useGameplayStore((s) => s.inSellArea);
  const [request, setRequest] = useState<QuantityRequest | null>(null);
  const [dragItem, setDragItem] = useState<string | null>(null);

  if (!player) return null;

  const stats = deriveStats(player.upgrades);
  const used = inventoryUsed(player.inventory);
  const slots = stats.inventorySlots;
  const entries = Object.entries(player.inventory).filter(([, q]) => q > 0);
  const sale = computeSale(
    player.inventory,
    Object.fromEntries(entries.filter(([id]) => getItem(id).sellPrice > 0)),
    player.upgrades,
  );

  const cells = Array.from({ length: Math.max(slots, 10) }, (_, i) => i);
  const flat = entries.map(([id, qty]) => ({ id, qty }));

  const ask = (kind: QuantityRequest['kind'], item: string) => {
    const max = player.inventory[item] ?? 0;
    if (max <= 0) return;
    const def = getItem(item);
    const note =
      kind === 'sell'
        ? `${moneyExact(Math.round(def.sellPrice * stats.sellMultiplier))} por unidad`
        : kind === 'drop'
          ? 'Quedará a tus pies. Cualquiera puede recogerlo.'
          : undefined;
    setRequest({ kind, item, max, note });
  };

  const confirm = async (qty: number) => {
    if (!request) return;
    const { kind, item } = request;
    setRequest(null);
    switch (kind) {
      case 'drop':
        // Cae ligeramente delante del jugador, para no quedar bajo sus pies.
        await op('dropItem', {
          item,
          qty,
          at: { x: px, y: py + BALANCE.ground.dropOffset },
        });
        break;
      case 'trash':
        await op('trashItem', { item, qty });
        break;
      case 'sell':
        await op('sell', { items: { [item]: qty }, at: { x: px, y: py } });
        break;
    }
  };

  const dropZone = (kind: 'drop' | 'trash') => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const item = e.dataTransfer.getData('text/plain') || dragItem;
      setDragItem(null);
      if (item) ask(kind, item);
    },
    onPointerUp: () => {
      if (dragItem) {
        ask(kind, dragItem);
        setDragItem(null);
      }
    },
  });

  return (
    <Panel
      icon="🎒"
      title="INVENTARIO"
      footer={
        <>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)' }}>
            Valor de venta total
            <div
              className="mono-num"
              style={{ fontSize: 17, fontWeight: 800, color: 'var(--amber-soft)' }}
            >
              {moneyExact(sale.money)}
            </div>
          </div>
          <button
            className="btn btn-amber"
            disabled={busy || sale.units === 0 || !inSellArea}
            onClick={() => void op('sell', { at: { x: px, y: py } })}
            title={
              inSellArea
                ? 'Vender todo lo vendible'
                : 'Sólo puedes vender dentro del MUELLE DE CARGA'
            }
          >
            💰 Vender todo
          </button>
        </>
      }
    >
      {!inSellArea && (
        <div
          className="card"
          style={{ fontSize: 12, color: 'var(--text-dim)', borderColor: 'rgba(251,191,36,0.3)' }}
        >
          🚚 Estás fuera del <b>MUELLE DE CARGA</b>: la venta está bloqueada. Acércate al
          muelle para vender.
        </div>
      )}

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
            background:
              used >= slots ? 'linear-gradient(135deg,#f87171,#dc2626)' : 'var(--grad-cyan)',
          }}
        />
      </div>

      <div className="inv-grid">
        {cells.map((i) => {
          const item = flat[i];
          if (i >= slots) return <div key={i} className="inv-slot locked" />;
          if (!item)
            return (
              <div key={i} className="inv-slot empty">
                ·
              </div>
            );
          const def = getItem(item.id);
          return (
            <div
              key={i}
              className="inv-slot filled"
              draggable
              style={{ ['--slot-color' as string]: def.color }}
              title={`${def.name} — arrastra al suelo o al basurero`}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', item.id);
                setDragItem(item.id);
              }}
              onDragEnd={() => setDragItem(null)}
              onPointerDown={() => setDragItem(item.id)}
            >
              {def.icon}
              <span className="qty">{item.qty}</span>
            </div>
          );
        })}
      </div>

      {/* Zonas de arrastre: soltar al suelo y basurero */}
      <div className="drop-zones">
        <div className="drop-zone ground" data-armed={!!dragItem} {...dropZone('drop')}>
          <span className="ico">📤</span>
          <div>
            <div className="t">SOLTAR AL SUELO</div>
            <div className="s">Arrastra un objeto aquí</div>
          </div>
        </div>
        <div className="drop-zone trash" data-armed={!!dragItem} {...dropZone('trash')}>
          <span className="ico">🗑️</span>
          <div>
            <div className="t">BASURERO</div>
            <div className="s">Elimina definitivamente</div>
          </div>
        </div>
      </div>

      <div className="section-title">CONTENIDO</div>
      {entries.length === 0 && (
        <div className="empty-note">
          Mochila vacía.
          <br />
          Ve al <b>YACIMIENTO</b> o a <b>RECOLECCIÓN</b> y extrae material.
        </div>
      )}
      {entries.map(([id, qty]) => {
        const def = getItem(id);
        const usable = !!CONSUMABLE_EFFECTS[id];
        return (
          <div className="card" key={id}>
            <div className="item-row">
              <span className="ico">{def.icon}</span>
              <div className="name">
                {def.name}
                <div className="meta">{def.desc}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="val mono-num">×{qty}</div>
                {def.sellPrice > 0 && (
                  <div className="meta">
                    {moneyExact(def.sellPrice * qty * stats.sellMultiplier)}
                  </div>
                )}
              </div>
            </div>
            <div className="item-actions">
              {usable && (
                <button className="btn btn-sm" disabled={busy} onClick={() => void op('useItem', { itemId: id })}>
                  Usar
                </button>
              )}
              {def.sellPrice > 0 && (
                <button
                  className="btn btn-sm"
                  disabled={busy || !inSellArea}
                  title={inSellArea ? 'Vender una cantidad' : 'Sólo en el muelle de carga'}
                  onClick={() => ask('sell', id)}
                >
                  💰 Vender…
                </button>
              )}
              <button className="btn btn-sm" disabled={busy} onClick={() => ask('drop', id)}>
                📤 Soltar…
              </button>
              <button
                className="btn btn-sm"
                style={{ borderColor: 'rgba(248,113,113,0.4)', color: 'var(--red)' }}
                disabled={busy}
                onClick={() => ask('trash', id)}
              >
                🗑️
              </button>
            </div>
          </div>
        );
      })}

      {request && (
        <QuantityDialog
          request={request}
          onCancel={() => setRequest(null)}
          onConfirm={(q) => void confirm(q)}
        />
      )}
    </Panel>
  );
}

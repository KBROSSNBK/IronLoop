import { useEffect, useState } from 'react';
import { getItem } from '../../config/items';

export interface QuantityRequest {
  kind: 'drop' | 'trash' | 'sell' | 'withdraw';
  item: string;
  max: number;
  /** Texto extra bajo el título (valor de venta, aviso…). */
  note?: string;
}

const COPY: Record<QuantityRequest['kind'], { title: string; verb: string; tone: string }> = {
  drop: { title: 'SOLTAR AL SUELO', verb: 'Soltar', tone: 'var(--blue)' },
  trash: { title: 'DESTRUIR', verb: 'Destruir', tone: 'var(--red)' },
  sell: { title: 'VENDER', verb: 'Vender', tone: 'var(--amber-soft)' },
  withdraw: { title: 'RETIRAR DE LA MÁQUINA', verb: 'Retirar', tone: 'var(--green)' },
};

/**
 * Diálogo de cantidad reutilizado por soltar, destruir, vender y retirar.
 * Destruir exige además una confirmación explícita: es la única acción del
 * juego que borra material sin devolver nada.
 */
export function QuantityDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: QuantityRequest;
  onCancel: () => void;
  onConfirm: (qty: number) => void;
}) {
  const def = getItem(request.item);
  const copy = COPY[request.kind];
  const [qty, setQty] = useState(request.max);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setQty(request.max);
    setConfirming(false);
  }, [request]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const clamp = (v: number) => Math.max(1, Math.min(request.max, Math.floor(v) || 1));

  const submit = () => {
    if (request.kind === 'trash' && !confirming) {
      setConfirming(true);
      return;
    }
    onConfirm(clamp(qty));
  };

  return (
    <div className="modal-scrim" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal bevel" style={{ gap: 11 }}>
        <h2 style={{ color: copy.tone }}>{copy.title}</h2>
        <div style={{ fontSize: 30 }}>{def.icon}</div>
        <div style={{ fontWeight: 700 }}>{def.name}</div>
        {request.note && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{request.note}</div>
        )}

        {confirming ? (
          <>
            <div
              className="card"
              style={{ borderColor: 'var(--red)', fontSize: 13.5, textAlign: 'center' }}
            >
              ¿Seguro que quieres eliminar <b>{clamp(qty)}</b> × {def.name}?
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>
                No genera dinero y no se puede recuperar.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirming(false)}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{ flex: 1, borderColor: 'var(--red)', color: 'var(--red)' }}
                onClick={() => onConfirm(clamp(qty))}
              >
                Eliminar
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => setQty((q) => clamp(q - 1))}>
                −
              </button>
              <input
                className="name-input"
                style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 18 }}
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(Number(e.target.value.replace(/\D/g, '')) || 1)}
                onBlur={() => setQty((q) => clamp(q))}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <button className="btn btn-sm" onClick={() => setQty((q) => clamp(q + 1))}>
                +
              </button>
            </div>

            <input
              type="range"
              min={1}
              max={Math.max(1, request.max)}
              value={Math.min(qty, request.max)}
              onChange={(e) => setQty(Number(e.target.value))}
              style={{ width: '100%', accentColor: copy.tone }}
            />

            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setQty(1)}>
                1
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setQty(Math.max(1, Math.floor(request.max / 2)))}
              >
                Mitad
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setQty(request.max)}>
                Todo ({request.max})
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={submit}
                disabled={request.max <= 0}
              >
                {copy.verb}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

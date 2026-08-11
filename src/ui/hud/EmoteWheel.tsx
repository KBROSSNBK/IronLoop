import { useEffect, useRef, useState } from 'react';
import { EMOTES } from '../../config/emotes';
import { triggerEmote } from '../../game/engine/input';
import { useUiStore } from '../../state/useUiStore';
import { playSfx } from '../../services/audio';

/**
 * Selector de emotes. En escritorio además funcionan las teclas 1–8.
 * Se cierra solo al elegir o al tocar fuera.
 */
export function EmoteWheel() {
  const isTouch = useUiStore((s) => s.isTouch);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    triggerEmote(id);
    playSfx('click');
    setOpen(false);
  };

  return (
    <div className="emote-dock" data-touch={isTouch} ref={ref}>
      {open && (
        <div className="emote-grid bevel-sm">
          {EMOTES.map((e) => (
            <button
              key={e.id}
              className="emote-item"
              title={`${e.name} (${e.hotkey})`}
              onPointerDown={(ev) => {
                ev.preventDefault();
                pick(e.id);
              }}
            >
              <span className="ico">{e.icon}</span>
              <span className="nm">{e.name}</span>
              {!isTouch && <span className="kb">{e.hotkey}</span>}
            </button>
          ))}
        </div>
      )}
      <button
        className={`emote-btn bevel-sm${open ? ' open' : ''}`}
        aria-label="Emotes"
        title="Emotes (teclas 1–8)"
        onPointerDown={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setOpen((v) => !v);
          playSfx('click');
        }}
      >
        😄
      </button>
    </div>
  );
}

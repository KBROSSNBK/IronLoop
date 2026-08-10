import { useEffect, useRef, useState } from 'react';
import { setJoystick, setTouchSprint } from '../../game/engine/input';

const RADIUS = 44;

/** Joystick virtual: aparece sólo en dispositivos táctiles (esquina inferior izq.). */
export function Joystick() {
  const zoneRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [sprint, setSprint] = useState(false);

  useEffect(() => () => setJoystick(0, 0), []);

  const update = (clientX: number, clientY: number) => {
    const el = zoneRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS) {
      dx = (dx / dist) * RADIUS;
      dy = (dy / dist) * RADIUS;
    }
    setKnob({ x: dx, y: dy });
    // Zona muerta del 14% para evitar deriva.
    const nx = dx / RADIUS;
    const ny = dy / RADIUS;
    const mag = Math.hypot(nx, ny);
    if (mag < 0.14) setJoystick(0, 0);
    else setJoystick(nx, ny);
  };

  const release = () => {
    pointerId.current = null;
    setKnob({ x: 0, y: 0 });
    setJoystick(0, 0);
  };

  return (
    <>
      <div
        ref={zoneRef}
        className="joystick"
        onPointerDown={(e) => {
          e.preventDefault();
          pointerId.current = e.pointerId;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          update(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (pointerId.current !== e.pointerId) return;
          update(e.clientX, e.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        aria-label="Joystick de movimiento"
      >
        <div className="ring" />
        <div
          className="knob"
          style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        />
      </div>

      <button
        className="sprint-btn bevel-sm"
        data-on={sprint}
        aria-label="Correr"
        onPointerDown={(e) => {
          e.preventDefault();
          setSprint(true);
          setTouchSprint(true);
        }}
        onPointerUp={() => {
          setSprint(false);
          setTouchSprint(false);
        }}
        onPointerLeave={() => {
          setSprint(false);
          setTouchSprint(false);
        }}
      >
        ⚡
      </button>
    </>
  );
}

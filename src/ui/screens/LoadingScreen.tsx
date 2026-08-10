import { useEffect, useState } from 'react';

const STEPS = [
  'Autenticando operario',
  'Cargando progreso personal',
  'Buscando fábrica disponible',
  'Sincronizando maquinaria',
  'Encendiendo las luces',
];

export function LoadingScreen({ label }: { label?: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = window.setInterval(
      () => setStep((s) => Math.min(STEPS.length - 1, s + 1)),
      420,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="screen">
      <div className="screen-bg" />
      <div className="logo" style={{ fontSize: 'clamp(26px,7vw,46px)' }}>
        IRONLOOP
      </div>
      <div className="loader-ring" />
      <div className="loader-steps">
        {STEPS.map((s, i) => (
          <span key={s} className={i <= step ? 'on' : undefined}>
            {i < step ? '✓' : i === step ? '▸' : '·'} {s}
          </span>
        ))}
      </div>
      {label && <div className="tagline">{label}</div>}
    </div>
  );
}

/**
 * RESCATE DE LAS PARTIDAS QUE ESTABAN EN FIRESTORE.
 *
 * Cambiar de base de datos no puede costarle a nadie su progreso. La primera
 * vez que un jugador entra con el backend nuevo, la Realtime Database no sabe
 * nada de él; antes de darlo por nuevo se mira en Firestore, y si allí había
 * partida se copia tal cual: jugador, fábrica y miembros.
 *
 * Ocurre UNA vez por jugador. A partir de ahí la RTDB es la única fuente y
 * Firestore queda como copia de seguridad congelada — no se borra nada, así
 * que si algo saliera mal siempre se puede volver poniendo VITE_BACKEND=firestore.
 *
 * Si Firestore no responde (cuota agotada, que es justo lo que nos trajo aquí)
 * el rescate se salta en silencio y el jugador arranca de cero en vez de
 * quedarse mirando una pantalla de carga.
 */

import { get, ref, update, type Database } from 'firebase/database';

import type { FactoryMember, FactoryState, PlayerState } from '../../../types';
import { limpiar } from './paths';

/** Corta el rescate si Firestore tarda: más vale jugar que esperar. */
const LIMITE_MS = 8000;

export async function importarDesdeFirestore(
  db: Database,
  uid: string,
): Promise<(Partial<PlayerState> & { rev?: number }) | null> {
  try {
    return await Promise.race([
      traer(db, uid),
      new Promise<null>((r) => setTimeout(() => r(null), LIMITE_MS)),
    ]);
  } catch {
    // Cuota agotada, reglas cerradas, sin red: se empieza limpio.
    return null;
  }
}

async function traer(
  db: Database,
  uid: string,
): Promise<(Partial<PlayerState> & { rev?: number }) | null> {
  const { getApp } = await import('firebase/app');
  const { collection, doc, getDoc, getDocs, getFirestore } = await import(
    'firebase/firestore'
  );

  const fs = getFirestore(getApp());
  const snap = await getDoc(doc(fs, 'users', uid));
  if (!snap.exists()) return null;

  const player = snap.data() as Partial<PlayerState>;
  const cambios: Record<string, unknown> = {
    [`users/${uid}`]: limpiar({ ...player, rev: 0 }),
  };

  // La fábrica se trae sólo si aún no está en la RTDB. El primero de la
  // tripulación que entre la sube; los demás ya se la encuentran puesta y no
  // deben pisarla con la foto vieja de Firestore, que a esas alturas puede
  // llevar horas de retraso.
  const fid = player.factoryId;
  const yaSubida = fid
    ? (await get(ref(db, `factories/${fid}/state/createdAt`))).exists()
    : true;
  if (fid && !yaSubida) {
    const fSnap = await getDoc(doc(fs, 'factories', fid));
    if (fSnap.exists()) {
      const factory = fSnap.data() as Partial<FactoryState>;
      const mSnap = await getDocs(collection(fs, 'factories', fid, 'members'));
      const miembros: Record<string, FactoryMember> = {};
      for (const d of mSnap.docs) miembros[d.id] = d.data() as FactoryMember;

      cambios[`factories/${fid}/state`] = limpiar({ ...factory, id: fid, rev: 0 });
      if (Object.keys(miembros).length > 0) {
        cambios[`factories/${fid}/members`] = limpiar(miembros);
      }
      cambios[`factoryIndex/${fid}`] = {
        playerCount: factory.playerCount ?? 1,
        name: factory.name ?? 'FACTORY',
        level: factory.level ?? 1,
      };
    }
  }

  await update(ref(db), cambios);
  return { ...player, rev: 0 };
}

/**
 * CLOUD FUNCTIONS — camino seguro de producción.
 *
 * `gameOp` ejecuta EXACTAMENTE los mismos reductores puros que el cliente
 * (`src/services/backend/ops.ts`), pero:
 *   · con `now` del servidor (el cliente no puede adelantar el reloj),
 *   · con el Admin SDK (se salta las Security Rules), lo que permite poner
 *     las reglas de Firestore en `allow write: if false` y dejar al cliente
 *     sin ninguna capacidad de escritura directa,
 *   · con limitación de frecuencia por jugador.
 *
 * Activación en el cliente: VITE_USE_FUNCTIONS=true
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import {
  normalizeFactory,
  normalizePlayer,
} from '../../src/game/logic/defaults';
import { runOp, type OpName } from '../../src/services/backend/ops';
import type { FactoryMember, FactoryState, PlayerState } from '../../src/types';

initializeApp();
const db = getFirestore();

/** Operaciones que el cliente puede solicitar. `tick` incluido. */
const ALLOWED_OPS: OpName[] = [
  'gather',
  'deposit',
  'collect',
  'sell',
  'contribute',
  'buyUpgrade',
  'upgradeMachine',
  'claimMission',
  'claimOffline',
  'useItem',
  'setAppearance',
  'tick',
];

/** Intervalo mínimo entre operaciones del mismo jugador (anti-macro). */
const MIN_OP_INTERVAL_MS = 120;

interface GameOpRequest {
  factoryId: string;
  op: OpName;
  args?: Record<string, unknown>;
}

export const gameOp = onCall<GameOpRequest>(
  { region: 'europe-west1', maxInstances: 20, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const { factoryId, op, args } = request.data ?? ({} as GameOpRequest);
    if (!factoryId || typeof factoryId !== 'string') {
      throw new HttpsError('invalid-argument', 'factoryId requerido.');
    }
    if (!ALLOWED_OPS.includes(op)) {
      throw new HttpsError('invalid-argument', `Operación no permitida: ${op}`);
    }

    const userRef = db.doc(`users/${uid}`);
    const factoryRef = db.doc(`factories/${factoryId}`);
    const memberRef = db.doc(`factories/${factoryId}/members/${uid}`);

    try {
      return await db.runTransaction(async (tx: Transaction) => {
        const [userSnap, factorySnap, memberSnap] = await Promise.all([
          tx.get(userRef),
          tx.get(factoryRef),
          tx.get(memberRef),
        ]);

        if (!userSnap.exists) throw new HttpsError('not-found', 'Jugador no encontrado.');
        if (!factorySnap.exists) throw new HttpsError('not-found', 'Fábrica no encontrada.');
        if (!memberSnap.exists) {
          throw new HttpsError('permission-denied', 'No perteneces a esta fábrica.');
        }

        const raw = userSnap.data() as Partial<PlayerState> & { lastOpAt?: number };

        // El tiempo SIEMPRE es del servidor: así `settleMachine` y la
        // regeneración de estamina no se pueden acelerar desde el cliente.
        const now = Date.now();

        if (raw.lastOpAt && now - raw.lastOpAt < MIN_OP_INTERVAL_MS) {
          throw new HttpsError('resource-exhausted', 'Vas demasiado rápido.');
        }

        const player = normalizePlayer(raw);
        const factory = normalizeFactory(
          factorySnap.data() as Partial<FactoryState>,
          factoryId,
        );

        const out = runOp(op, player, factory, { ...(args ?? {}), now });
        if (!out.ok) return out;

        if (out.player) {
          tx.set(userRef, { ...out.player, lastOpAt: now }, { merge: false });
        }
        if (out.factory) {
          tx.set(factoryRef, { ...out.factory, updatedAt: now }, { merge: false });
        }

        const cur = memberSnap.data() as FactoryMember;
        const next: FactoryMember = { ...cur, lastSeenAt: now };
        for (const [key, value] of Object.entries(out.memberDelta ?? {})) {
          if (key === 'money') next.money = value as number;
          else {
            const record = next as unknown as Record<string, number>;
            record[key] = (record[key] ?? 0) + (value as number);
          }
        }
        if (out.player) {
          next.level = out.player.level;
          next.name = out.player.name;
          next.money = out.player.money;
        }
        tx.set(memberRef, next);

        return out;
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error('gameOp falló', { uid, op, error: e });
      throw new HttpsError('internal', 'Error al ejecutar la operación.');
    }
  },
);

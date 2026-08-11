import { BALANCE } from '../../config/balance';
import { MACHINE_LIST } from '../../config/machines';
import { DEFAULT_APPEARANCE, randomAppearance } from '../../config/cosmetics';
import { ACTIVE_MISSION_SLOTS, rollMissions } from '../../config/missions';
import type {
  AuthUser,
  FactoryMember,
  FactoryState,
  LifetimeStats,
  MachineState,
  PlayerState,
  RobotState,
} from '../../types';

export function emptyStats(): LifetimeStats {
  return {
    gathered: 0,
    deposited: 0,
    produced: 0,
    sold: 0,
    earned: 0,
    contributed: 0,
    upgradesBought: 0,
    playtime: 0,
  };
}

export function createPlayerState(user: AuthUser, now = Date.now()): PlayerState {
  const name =
    (user.displayName || user.email?.split('@')[0] || 'Operario').slice(0, 20);
  return {
    uid: user.uid,
    name,
    photoURL: user.photoURL ?? null,
    appearance: { ...DEFAULT_APPEARANCE, ...randomAppearance() },
    level: 1,
    xp: 0,
    money: BALANCE.player.startingMoney,
    stamina: BALANCE.player.startingStamina,
    staminaAt: now,
    upgrades: {},
    inventory: {},
    missions: rollMissions(1, [], ACTIVE_MISSION_SLOTS).map((id) => ({
      id,
      progress: 0,
      claimed: false,
      startedAt: now,
    })),
    stats: emptyStats(),
    factoryId: null,
    createdAt: now,
    lastSeenAt: now,
    lastOfflineClaimAt: now,
    onboarded: false,
    resetAckAt: 0,
  };
}

export function createMachineState(): MachineState {
  return { level: 0, input: {}, output: {}, cycleStartAt: 0, cycles: 0 };
}

export function createFactoryState(id: string, index: number, now = Date.now()): FactoryState {
  const machines: Record<string, MachineState> = {};
  for (const m of MACHINE_LIST) machines[m.id] = createMachineState();
  return {
    id,
    name: `FACTORY #${String(index).padStart(3, '0')}`,
    level: 1,
    contribution: 0,
    totalContribution: 0,
    machines,
    robots: {},
    stats: { gathered: 0, produced: 0, sold: 0, contributed: 0 },
    objectives: {},
    playerCount: 0,
    createdAt: now,
    updatedAt: now,
    prestige: 0,
    resetAt: 0,
  };
}

export function createMember(p: PlayerState, now = Date.now()): FactoryMember {
  return {
    uid: p.uid,
    name: p.name,
    photoURL: p.photoURL,
    level: p.level,
    contributed: 0,
    produced: 0,
    sold: 0,
    money: p.money,
    joinedAt: now,
    lastSeenAt: now,
  };
}

/**
 * Repara documentos antiguos o parcialmente escritos: garantiza que todos
 * los campos existen tras un despliegue que añade contenido nuevo.
 */
export function normalizePlayer(raw: Partial<PlayerState>, user?: AuthUser): PlayerState {
  const base = createPlayerState(
    user ?? {
      uid: raw.uid ?? 'unknown',
      displayName: raw.name ?? null,
      photoURL: raw.photoURL ?? null,
      email: null,
    },
    raw.createdAt ?? Date.now(),
  );
  return {
    ...base,
    ...raw,
    appearance: { ...base.appearance, ...(raw.appearance ?? {}) },
    upgrades: { ...(raw.upgrades ?? {}) },
    inventory: { ...(raw.inventory ?? {}) },
    stats: { ...base.stats, ...(raw.stats ?? {}) },
    missions:
      raw.missions && raw.missions.length ? raw.missions : base.missions,
  } as PlayerState;
}

export function normalizeFactory(raw: Partial<FactoryState>, id: string): FactoryState {
  const base = createFactoryState(id, 1, raw.createdAt ?? Date.now());
  const machines: Record<string, MachineState> = { ...base.machines };
  for (const [k, v] of Object.entries(raw.machines ?? {})) {
    machines[k] = { ...createMachineState(), ...v };
  }
  const robots: Record<string, RobotState> = {};
  for (const [k, v] of Object.entries(raw.robots ?? {})) {
    robots[k] = {
      level: v?.level ?? 0,
      lastRunAt: v?.lastRunAt ?? Date.now(),
      moved: v?.moved ?? 0,
    };
  }
  return {
    ...base,
    ...raw,
    id,
    machines,
    robots,
    stats: { ...base.stats, ...(raw.stats ?? {}) },
    objectives: { ...(raw.objectives ?? {}) },
  } as FactoryState;
}

/**
 * BACKEND LOCAL — sin Firebase.
 *
 * Persistencia en localStorage, multiplayer real entre pestañas del mismo
 * navegador vía BroadcastChannel. Sirve para dos cosas:
 *   1. Jugar/probar el loop completo sin configurar nada.
 *   2. Desarrollar sin gastar cuota de Firebase.
 *
 * Implementa exactamente el mismo contrato `Backend` que la versión Firebase,
 * así que cambiar de uno a otro no toca ni una línea de lógica de juego.
 */

import { BALANCE } from '../../../config/balance';
import type {
  AuthUser,
  FactoryMember,
  FactoryState,
  PlayerState,
  PresenceState,
} from '../../../types';
import {
  createFactoryState,
  createMember,
  createPlayerState,
  normalizeFactory,
  normalizePlayer,
} from '../../../game/logic/defaults';
import { runOp, type OpName, type OpOutcome } from '../ops';
import type { Backend, Unsub } from '../types';

const NS = 'ironloop';
const K = {
  uidSession: `${NS}:uid`,
  account: (uid: string) => `${NS}:account:${uid}`,
  player: (uid: string) => `${NS}:player:${uid}`,
  factory: (id: string) => `${NS}:factory:${id}`,
  members: (id: string) => `${NS}:members:${id}`,
  factoryIndex: `${NS}:factories`,
};

type Msg =
  | { t: 'presence'; fid: string; p: PresenceState }
  | { t: 'leave'; fid: string; uid: string }
  | { t: 'player'; uid: string }
  | { t: 'factory'; fid: string }
  | { t: 'members'; fid: string };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[local] no se pudo escribir', key, e);
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'operario'
  );
}

export class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  readonly label = 'Modo local (sin Firebase)';

  private channel: BroadcastChannel | null = null;
  private user: AuthUser | null = null;
  private authCbs = new Set<(u: AuthUser | null) => void>();
  private playerCbs = new Map<string, Set<(p: PlayerState) => void>>();
  private factoryCbs = new Map<string, Set<(f: FactoryState) => void>>();
  private memberCbs = new Map<string, Set<(m: FactoryMember[]) => void>>();
  private presenceCbs = new Map<string, Set<(p: PresenceState[]) => void>>();
  private remotePresence = new Map<string, Map<string, { p: PresenceState; at: number }>>();
  private pruneTimer: number | null = null;

  async init(): Promise<void> {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(NS);
      this.channel.onmessage = (ev) => this.onMessage(ev.data as Msg);
    }
    // Restaura la sesión de ESTA pestaña (sessionStorage ⇒ una cuenta por pestaña,
    // lo que permite probar multiplayer abriendo dos ventanas).
    const uid = sessionStorage.getItem(K.uidSession);
    if (uid) {
      const acc = read<AuthUser>(K.account(uid));
      if (acc) this.user = acc;
    }
    this.pruneTimer = window.setInterval(() => this.prunePresence(), 3000);
    queueMicrotask(() => this.authCbs.forEach((cb) => cb(this.user)));
  }

  dispose(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.channel?.close();
  }

  /* ─────────────────────────── Mensajería ─────────────────────────── */

  private post(msg: Msg): void {
    this.channel?.postMessage(msg);
  }

  private onMessage(msg: Msg): void {
    switch (msg.t) {
      case 'presence': {
        if (msg.p.uid === this.user?.uid) return;
        let map = this.remotePresence.get(msg.fid);
        if (!map) {
          map = new Map();
          this.remotePresence.set(msg.fid, map);
        }
        map.set(msg.p.uid, { p: msg.p, at: Date.now() });
        this.emitPresence(msg.fid);
        break;
      }
      case 'leave': {
        this.remotePresence.get(msg.fid)?.delete(msg.uid);
        this.emitPresence(msg.fid);
        break;
      }
      case 'player':
        this.emitPlayer(msg.uid);
        break;
      case 'factory':
        this.emitFactory(msg.fid);
        break;
      case 'members':
        this.emitMembers(msg.fid);
        break;
    }
  }

  private prunePresence(): void {
    const now = Date.now();
    for (const [fid, map] of this.remotePresence) {
      let changed = false;
      for (const [uid, entry] of map) {
        if (now - entry.at > BALANCE.net.staleAfterMs) {
          map.delete(uid);
          changed = true;
        }
      }
      if (changed) this.emitPresence(fid);
    }
  }

  /* ─────────────────────────── Autenticación ─────────────────────────── */

  onAuthChanged(cb: (u: AuthUser | null) => void): Unsub {
    this.authCbs.add(cb);
    queueMicrotask(() => cb(this.user));
    return () => this.authCbs.delete(cb);
  }

  async signInWithGoogle(): Promise<void> {
    // En modo local no hay OAuth: se crea una cuenta local equivalente.
    await this.signInAsGuest();
  }

  async signInAsGuest(nickname?: string): Promise<void> {
    const name = (nickname ?? this.suggestName()).trim().slice(0, 20) || 'Operario';
    const uid = `local_${slug(name)}`;
    const existing = read<AuthUser>(K.account(uid));
    const user: AuthUser = existing ?? {
      uid,
      displayName: name,
      photoURL: null,
      email: null,
      isAnonymous: true,
    };
    user.displayName = name;
    write(K.account(uid), user);
    sessionStorage.setItem(K.uidSession, uid);
    this.user = user;
    this.authCbs.forEach((cb) => cb(user));
  }

  /** Propone un nombre libre: Operario-1, Operario-2… */
  suggestName(): string {
    for (let i = 1; i <= 50; i++) {
      const candidate = `Operario-${i}`;
      if (!localStorage.getItem(K.account(`local_${slug(candidate)}`))) return candidate;
    }
    return `Operario-${Math.floor(Math.random() * 999)}`;
  }

  async signOut(): Promise<void> {
    sessionStorage.removeItem(K.uidSession);
    this.user = null;
    this.authCbs.forEach((cb) => cb(null));
  }

  /* ─────────────────────────── Jugador ─────────────────────────── */

  async loadPlayer(user: AuthUser): Promise<PlayerState> {
    const stored = read<PlayerState>(K.player(user.uid));
    const player = stored
      ? normalizePlayer(stored, user)
      : createPlayerState(user);
    write(K.player(user.uid), player);
    return player;
  }

  watchPlayer(uid: string, cb: (p: PlayerState) => void): Unsub {
    let set = this.playerCbs.get(uid);
    if (!set) {
      set = new Set();
      this.playerCbs.set(uid, set);
    }
    set.add(cb);
    const cur = read<PlayerState>(K.player(uid));
    if (cur) queueMicrotask(() => cb(normalizePlayer(cur)));
    return () => set!.delete(cb);
  }

  private emitPlayer(uid: string): void {
    const p = read<PlayerState>(K.player(uid));
    if (!p) return;
    this.playerCbs.get(uid)?.forEach((cb) => cb(normalizePlayer(p)));
  }

  async savePlayerSoft(uid: string, patch: Partial<PlayerState>): Promise<void> {
    const cur = read<PlayerState>(K.player(uid));
    if (!cur) return;
    write(K.player(uid), { ...cur, ...patch });
    this.emitPlayer(uid);
  }

  /* ─────────────────────────── Fábrica ─────────────────────────── */

  private factoryIndex(): string[] {
    return read<string[]>(K.factoryIndex) ?? [];
  }

  async joinFactory(player: PlayerState): Promise<string> {
    const index = this.factoryIndex();

    // 1. ¿Ya pertenece a una fábrica válida?
    if (player.factoryId && read<FactoryState>(K.factory(player.factoryId))) {
      this.registerMember(player.factoryId, player);
      return player.factoryId;
    }

    // 2. Busca una con hueco.
    for (const fid of index) {
      const members = read<Record<string, FactoryMember>>(K.members(fid)) ?? {};
      if (Object.keys(members).length < BALANCE.factory.maxPlayers) {
        this.registerMember(fid, player);
        return fid;
      }
    }

    // 3. Crea una nueva.
    const fid = `factory_${index.length + 1}_${Math.random().toString(36).slice(2, 7)}`;
    const factory = createFactoryState(fid, index.length + 1);
    write(K.factory(fid), factory);
    write(K.members(fid), {});
    write(K.factoryIndex, [...index, fid]);
    this.registerMember(fid, player);
    return fid;
  }

  private registerMember(fid: string, player: PlayerState): void {
    const members = read<Record<string, FactoryMember>>(K.members(fid)) ?? {};
    const existing = members[player.uid];
    members[player.uid] = existing
      ? { ...existing, name: player.name, level: player.level, money: player.money, lastSeenAt: Date.now() }
      : createMember(player);
    write(K.members(fid), members);

    const factory = read<FactoryState>(K.factory(fid));
    if (factory) {
      write(K.factory(fid), { ...factory, playerCount: Object.keys(members).length });
      this.post({ t: 'factory', fid });
    }
    this.post({ t: 'members', fid });
    this.emitMembers(fid);
  }

  async leaveFactory(fid: string, uid: string): Promise<void> {
    // El progreso se conserva: sólo se limpia la presencia efímera.
    await this.clearPresence(fid, uid);
    const members = read<Record<string, FactoryMember>>(K.members(fid)) ?? {};
    if (members[uid]) {
      members[uid] = { ...members[uid], lastSeenAt: Date.now() };
      write(K.members(fid), members);
      this.post({ t: 'members', fid });
    }
  }

  watchFactory(fid: string, cb: (f: FactoryState) => void): Unsub {
    let set = this.factoryCbs.get(fid);
    if (!set) {
      set = new Set();
      this.factoryCbs.set(fid, set);
    }
    set.add(cb);
    const cur = read<FactoryState>(K.factory(fid));
    if (cur) queueMicrotask(() => cb(normalizeFactory(cur, fid)));
    return () => set!.delete(cb);
  }

  private emitFactory(fid: string): void {
    const f = read<FactoryState>(K.factory(fid));
    if (!f) return;
    this.factoryCbs.get(fid)?.forEach((cb) => cb(normalizeFactory(f, fid)));
  }

  watchMembers(fid: string, cb: (m: FactoryMember[]) => void): Unsub {
    let set = this.memberCbs.get(fid);
    if (!set) {
      set = new Set();
      this.memberCbs.set(fid, set);
    }
    set.add(cb);
    queueMicrotask(() => this.emitMembers(fid));
    return () => set!.delete(cb);
  }

  private emitMembers(fid: string): void {
    const map = read<Record<string, FactoryMember>>(K.members(fid)) ?? {};
    const list = Object.values(map);
    this.memberCbs.get(fid)?.forEach((cb) => cb(list));
  }

  /* ─────────────────────────── Operaciones ─────────────────────────── */

  async runOp(
    uid: string,
    fid: string,
    op: OpName,
    args: unknown,
  ): Promise<OpOutcome> {
    const player = read<PlayerState>(K.player(uid));
    const factory = read<FactoryState>(K.factory(fid));
    if (!player || !factory) {
      return { ok: false, reason: 'Estado no disponible', events: [] };
    }

    const out = runOp(op, normalizePlayer(player), normalizeFactory(factory, fid), args);
    if (!out.ok) return out;

    if (out.player) {
      write(K.player(uid), out.player);
      this.emitPlayer(uid);
      this.post({ t: 'player', uid });
    }
    if (out.factory) {
      write(K.factory(fid), out.factory);
      this.emitFactory(fid);
      this.post({ t: 'factory', fid });
    }
    if (out.memberDelta || out.player) {
      const members = read<Record<string, FactoryMember>>(K.members(fid)) ?? {};
      const cur = members[uid];
      if (cur) {
        const next: FactoryMember = { ...cur, lastSeenAt: Date.now() };
        for (const [k, v] of Object.entries(out.memberDelta ?? {})) {
          if (k === 'money') next.money = v as number;
          else (next as unknown as Record<string, number>)[k] =
            ((next as unknown as Record<string, number>)[k] ?? 0) + (v as number);
        }
        if (out.player) {
          next.level = out.player.level;
          next.name = out.player.name;
          next.money = out.player.money;
        }
        members[uid] = next;
        write(K.members(fid), members);
        this.emitMembers(fid);
        this.post({ t: 'members', fid });
      }
    }
    return out;
  }

  /* ─────────────────────────── Presencia ─────────────────────────── */

  publishPresence(fid: string, state: PresenceState): void {
    this.post({ t: 'presence', fid, p: state });
  }

  watchPresence(
    fid: string,
    _selfUid: string,
    cb: (p: PresenceState[]) => void,
  ): Unsub {
    let set = this.presenceCbs.get(fid);
    if (!set) {
      set = new Set();
      this.presenceCbs.set(fid, set);
    }
    set.add(cb);
    queueMicrotask(() => this.emitPresence(fid));
    return () => set!.delete(cb);
  }

  private emitPresence(fid: string): void {
    const map = this.remotePresence.get(fid);
    const list = map ? [...map.values()].map((e) => e.p) : [];
    this.presenceCbs.get(fid)?.forEach((cb) => cb(list));
  }

  async clearPresence(fid: string, uid: string): Promise<void> {
    this.post({ t: 'leave', fid, uid });
  }

  /* ─────────────────────────── Debug ─────────────────────────── */

  async debugPatchPlayer(uid: string, patch: Partial<PlayerState>): Promise<void> {
    const cur = read<PlayerState>(K.player(uid));
    if (!cur) return;
    write(K.player(uid), normalizePlayer({ ...cur, ...patch }));
    this.emitPlayer(uid);
    this.post({ t: 'player', uid });
  }

  async debugPatchFactory(fid: string, patch: Partial<FactoryState>): Promise<void> {
    const cur = read<FactoryState>(K.factory(fid));
    if (!cur) return;
    write(K.factory(fid), normalizeFactory({ ...cur, ...patch }, fid));
    this.emitFactory(fid);
    this.post({ t: 'factory', fid });
  }
}

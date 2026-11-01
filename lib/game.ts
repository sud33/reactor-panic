export const MAX_ROUNDS = 7;
export const DECISION_MS = 80_000;
export const REVEAL_MS = 12_000;
export const LOCKED_RESOLVE_MS = 5_000;
export const ACTIVE_PLAYER_MS = 15_000;
export const RECONNECT_GRACE_MS = 45_000;
export const MAX_BATTERY = 6;

export type Action = {
  repair: number;
  shield: number;
  investigate: number;
  recharge: number;
  sabotage: number;
};
export type Objective =
  | "engineer"
  | "guardian"
  | "analyst"
  | "survivor"
  | "wildcard";
export type EventId =
  | "flare"
  | "leak"
  | "meteors"
  | "surge"
  | "signal"
  | "radiation"
  | "drift";
export type Player = {
  id: string;
  tokenHash: string;
  name: string;
  ready: boolean;
  score: number;
  battery: number;
  objective: Objective;
  stats: {
    repair: number;
    shield: number;
    investigate: number;
    sabotage: number;
  };
  submitted: Action | null;
  lastSeen: number;
  lastCommand: number;
};
export type RoundLog = {
  round: number;
  event: EventId;
  seed: string;
  commit: string;
  before: number;
  after: number;
  eventDamage: number;
  sabotageDamage: number;
  shieldAbsorbed: number;
  repaired: number;
  investigationOccurred: boolean;
  revealed: {
    id: string;
    name: string;
    action: Action;
    autopilot: boolean;
    points: number;
    exposed: boolean;
  }[];
  failed: boolean;
};
export type Room = {
  code: string;
  hostId: string;
  phase: "lobby" | "decision" | "reveal" | "finished";
  players: Player[];
  round: number;
  health: number;
  maxHealth: number;
  event: EventId | null;
  seed: string | null;
  commit: string | null;
  deadline: number | null;
  logs: RoundLog[];
  winnerIds: string[];
  objectiveSeed: string | null;
  gameEnded: boolean;
  createdAt: number;
};

export type PlayerScoreBreakdown = {
  roundPoints: number;
  survivalBonus: number;
  sabotageReward: number;
  sabotageFailurePenalty: number;
  objectiveBonus: number;
  total: number;
};

export type VisibleRoundLog = Omit<RoundLog, "revealed"> & {
  revealed: Array<
    Pick<RoundLog["revealed"][number], "id" | "name" | "exposed"> &
      Partial<Pick<RoundLog["revealed"][number], "action" | "autopilot" | "points">>
  >;
};

export function exposureMessage(
  isOwnPlan: boolean,
  investigationOccurred: boolean,
): string {
  if (investigationOccurred)
    return isOwnPlan
      ? "Your sabotage was exposed by the crew investigation"
      : "Sabotage exposed by the crew investigation";
  return isOwnPlan
    ? "Your sabotage was detected by station sensors"
    : "Sabotage detected by station sensors";
}

export function normalizeNicknameInput(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function limitNicknameInput(value: string): string {
  return value.replace(/^\s+/, "").replace(/\s+/g, " ").slice(0, 16);
}

export function savedSeatMatchesName(
  enteredName: string,
  savedName: string,
): boolean {
  return (
    normalizeNicknameInput(enteredName).toLocaleLowerCase() ===
    normalizeNicknameInput(savedName).toLocaleLowerCase()
  );
}

export const EMPTY_ACTION: Action = {
  repair: 0,
  shield: 0,
  investigate: 0,
  recharge: 0,
  sabotage: 0,
};
export const EVENT_INFO: Record<
  EventId,
  {
    title: string;
    detail: string;
    damage: number;
    repairBoost?: number;
    shieldBoost?: number;
    rechargeBoost?: number;
    investigateBoost?: number;
  }
> = {
  flare: {
    title: "Solar flare",
    detail: "Shields are unusually effective.",
    damage: 5,
    shieldBoost: 1,
  },
  leak: {
    title: "Coolant leak",
    detail: "Repairs restore an extra hull point.",
    damage: 5,
    repairBoost: 1,
  },
  meteors: {
    title: "Meteor swarm",
    detail: "A heavy impact is incoming.",
    damage: 6,
  },
  surge: {
    title: "Power surge",
    detail: "Recharging yields an extra energy next round.",
    damage: 4,
    rechargeBoost: 1,
  },
  signal: {
    title: "Ghost signal",
    detail: "Investigation yields an extra point.",
    damage: 4,
    investigateBoost: 1,
  },
  radiation: {
    title: "Radiation storm",
    detail: "Shelter the station from a sharp hit.",
    damage: 5,
  },
  drift: {
    title: "Orbital drift",
    detail: "A brief window to rebuild.",
    damage: 3,
  },
};
export const OBJECTIVE_INFO: Record<
  Objective,
  { title: string; detail: string }
> = {
  engineer: {
    title: "Chief engineer",
    detail: "Spend 5 energy on repair across the game: +5 points.",
  },
  guardian: {
    title: "Station guardian",
    detail: "Spend 5 energy on shield across the game: +5 points.",
  },
  analyst: {
    title: "Signal analyst",
    detail: "Spend 5 energy on investigation across the game: +5 points.",
  },
  survivor: {
    title: "Last watch",
    detail: "Finish round 7 with the reactor above half health: +5 points.",
  },
  wildcard: {
    title: "Risk officer",
    detail: "Sabotage exactly once and survive round 7: +5 points.",
  },
};

export function actionCost(a: Action): number {
  return a.repair + a.shield + a.investigate + a.recharge + a.sabotage * 2;
}
export function validateAction(raw: unknown, battery: number): Action {
  if (!raw || typeof raw !== "object")
    throw new Error("Choose an action allocation.");
  const a = raw as Record<string, unknown>;
  const keys = [
    "repair",
    "shield",
    "investigate",
    "recharge",
    "sabotage",
  ] as const;
  const next = {} as Action;
  for (const k of keys) {
    const value = a[k];
    if (
      !Number.isInteger(value) ||
      (value as number) < 0 ||
      (value as number) > 6
    )
      throw new Error("Use whole energy units from 0 to 6.");
    next[k] = value as number;
  }
  if (next.sabotage > 1)
    throw new Error("Only one sabotage attempt is allowed per round.");
  if (actionCost(next) > battery)
    throw new Error("This plan exceeds your energy budget.");
  return next;
}

// Integer-only PRNG. The round seed is committed before actions and revealed afterward.
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function eventFor(seed: string): EventId {
  const events = Object.keys(EVENT_INFO) as EventId[];
  return events[Math.floor(rng(seed)() * events.length)];
}
export function objectiveFor(seed: string, index: number): Objective {
  const objectives = Object.keys(OBJECTIVE_INFO) as Objective[];
  return objectives[
    Math.floor(rng(`${seed}:objective:${index}`)() * objectives.length)
  ];
}
export function createRoom(code: string, host: Player, now: number): Room {
  return {
    code,
    hostId: host.id,
    phase: "lobby",
    players: [host],
    round: 0,
    health: 0,
    maxHealth: 0,
    event: null,
    seed: null,
    commit: null,
    deadline: null,
    logs: [],
    winnerIds: [],
    objectiveSeed: null,
    gameEnded: false,
    createdAt: now,
  };
}

export function shortenDeadlineWhenLocked(room: Room, now: number): Room {
  if (room.phase !== "decision" || !room.deadline) return room;
  const presentOrReconnecting = room.players.filter(
    (p) => now - p.lastSeen < RECONNECT_GRACE_MS,
  );
  if (
    !presentOrReconnecting.length ||
    presentOrReconnecting.some((p) => !p.submitted)
  )
    return room;
  const earlyDeadline = now + LOCKED_RESOLVE_MS;
  return room.deadline > earlyDeadline
    ? { ...room, deadline: earlyDeadline }
    : room;
}

export function finishGame(room: Room): Room {
  if (!room.gameEnded && room.health > 0 && room.round < MAX_ROUNDS) return room;
  return { ...room, phase: "finished", deadline: null, gameEnded: true };
}

export function resetForRematch(room: Room, now: number): Room {
  if (room.phase !== "finished") throw new Error("The mission is still active.");
  return {
    ...room,
    phase: "lobby",
    players: room.players.map((p) => ({
      ...p,
      ready: false,
      score: 0,
      battery: 4,
      objective: "engineer",
      stats: { repair: 0, shield: 0, investigate: 0, sabotage: 0 },
      submitted: null,
      lastCommand: 0,
    })),
    round: 0,
    health: 0,
    maxHealth: 0,
    event: null,
    seed: null,
    commit: null,
    deadline: null,
    logs: [],
    winnerIds: [],
    objectiveSeed: null,
    gameEnded: false,
    createdAt: now,
  };
}

export function transferHostIfAbsent(room: Room, now: number): Room {
  if (room.phase !== "lobby") return room;
  const host = room.players.find((p) => p.id === room.hostId);
  if (!host || now - host.lastSeen <= 60_000) return room;
  const replacement = room.players.find(
    (p) => p.id !== host.id && now - p.lastSeen < 25_000,
  );
  return replacement ? { ...room, hostId: replacement.id } : room;
}
export function beginGame(
  room: Room,
  seed: string,
  commit: string,
  objectiveSeed: string,
  now: number,
): Room {
  if (
    room.phase !== "lobby" ||
    room.players.length < 3 ||
    room.players.length > 8 ||
    room.players.some((p) => !p.ready)
  )
    throw new Error("Three to eight ready players are needed.");
  const maxHealth = 10 + room.players.length * 2;
  return {
    ...room,
    phase: "decision",
    round: 1,
    health: maxHealth,
    maxHealth,
    players: room.players.map((p, i) => ({
      ...p,
      score: 0,
      battery: 4,
      objective: objectiveFor(objectiveSeed, i),
      stats: { repair: 0, shield: 0, investigate: 0, sabotage: 0 },
      submitted: null,
    })),
    event: eventFor(seed),
    seed,
    commit,
    objectiveSeed,
    deadline: now + DECISION_MS,
    logs: [],
    winnerIds: [],
    gameEnded: false,
  };
}
export function beginNextRound(
  room: Room,
  seed: string,
  commit: string,
  now: number,
): Room {
  if (room.phase !== "reveal" || room.round >= MAX_ROUNDS)
    throw new Error("No next round is available.");
  return {
    ...room,
    phase: "decision",
    round: room.round + 1,
    event: eventFor(seed),
    seed,
    commit,
    deadline: now + DECISION_MS,
    players: room.players.map((p) => ({ ...p, submitted: null })),
    gameEnded: false,
  };
}

export function objectiveBonusFor(
  player: Player,
  health: number,
  maxHealth: number,
  failed: boolean,
): number {
  if (failed) return 0;
  if (player.objective === "engineer" && player.stats.repair >= 5) return 5;
  if (player.objective === "guardian" && player.stats.shield >= 5) return 5;
  if (player.objective === "analyst" && player.stats.investigate >= 5) return 5;
  if (player.objective === "survivor" && health > maxHealth / 2) return 5;
  if (player.objective === "wildcard" && player.stats.sabotage === 1) return 5;
  return 0;
}

export function scoreBreakdownFor(room: Room, player: Player): PlayerScoreBreakdown {
  const failed = room.health === 0;
  const roundPoints = room.logs.reduce(
    (sum, log) => sum + (log.revealed.find((r) => r.id === player.id)?.points ?? 0),
    0,
  );
  const survivalBonus = failed ? -4 : 3;
  const sabotageReward = failed ? 0 : player.stats.sabotage * 3;
  const sabotageFailurePenalty =
    failed && player.stats.sabotage > 0 ? -6 : 0;
  const objectiveBonus = objectiveBonusFor(player, room.health, room.maxHealth, failed);
  return {
    roundPoints,
    survivalBonus,
    sabotageReward,
    sabotageFailurePenalty,
    objectiveBonus,
    total: player.score,
  };
}

export function visibleLogForPlayer(
  log: RoundLog,
  playerId: string,
  revealAll: boolean,
): VisibleRoundLog {
  return {
    ...log,
    revealed: log.revealed
      .filter((r) => revealAll || r.id === playerId || r.exposed)
      .map((r) =>
        revealAll || r.id === playerId
          ? { ...r }
          : { id: r.id, name: r.name, exposed: true },
      ),
  };
}
export function resolveRound(room: Room, now: number): Room {
  if (room.phase !== "decision" || !room.seed || !room.commit || !room.event)
    throw new Error("No active round to resolve.");
  const event = EVENT_INFO[room.event];
  const random = rng(room.seed);
  random(); // event draw
  const total = {
    repair: 0,
    shield: 0,
    investigate: 0,
    recharge: 0,
    sabotage: 0,
  };
  const actions = room.players.map((p) => {
    const autopilot = !p.submitted;
    const action = p.submitted ?? {
      ...EMPTY_ACTION,
      repair: Math.min(2, p.battery),
    };
    for (const k of Object.keys(total) as (keyof Action)[])
      total[k] += action[k];
    return { p, action, autopilot };
  });
  const repair = total.repair * (2 + (event.repairBoost ?? 0));
  const eventDamage = event.damage + Math.floor(room.players.length / 3);
  const sabotageDamage =
    total.sabotage > 0 ? Math.min(2, Math.max(0, room.health - 1)) : 0;
  const shieldCapacity = total.shield * (2 + (event.shieldBoost ?? 0));
  const shieldAbsorbed = Math.min(eventDamage + sabotageDamage, shieldCapacity);
  const after = Math.min(
    room.maxHealth,
    Math.max(
      0,
      room.health - Math.max(0, eventDamage + sabotageDamage - shieldAbsorbed),
    ) + repair,
  );
  const failed = after === 0;
  const auditChance = Math.min(0.75, 0.3 + total.investigate * 0.08);
  const revealed = actions.map(({ p, action, autopilot }) => {
    const exposed = action.sabotage > 0 && random() < auditChance;
    const usefulShield = shieldAbsorbed > 0 && action.shield > 0;
    const points = autopilot
      ? 0
      : action.repair * 2 +
        action.shield * (usefulShield ? 2 : 1) +
        action.investigate * (2 + (event.investigateBoost ?? 0)) +
        (exposed ? -4 : 0);
    return { id: p.id, name: p.name, action, autopilot, points, exposed };
  });
  const players = room.players.map((p, i) => {
    const { action, autopilot } = actions[i];
    return {
      ...p,
      score: p.score + revealed[i].points,
      battery: Math.min(
        MAX_BATTERY,
        p.battery -
          actionCost(action) +
          2 +
          action.recharge * (2 + (event.rechargeBoost ?? 0)),
      ),
      stats: autopilot
        ? p.stats
        : {
            repair: p.stats.repair + action.repair,
            shield: p.stats.shield + action.shield,
            investigate: p.stats.investigate + action.investigate,
            sabotage: p.stats.sabotage + action.sabotage,
          },
    };
  });
  const complete = failed || room.round === MAX_ROUNDS;
  if (complete) {
    for (const p of players) {
      if (failed) {
        p.score -= 4;
        if (p.stats.sabotage > 0) p.score -= 6;
      }
      else {
        p.score += 3;
        p.score += p.stats.sabotage * 3;
        p.score += objectiveBonusFor(p, after, room.maxHealth, false);
      }
    }
  }
  const log: RoundLog = {
    round: room.round,
    event: room.event,
    seed: room.seed,
    commit: room.commit,
    before: room.health,
    after,
    eventDamage,
    sabotageDamage,
    shieldAbsorbed,
    repaired: repair,
    investigationOccurred: total.investigate > 0,
    revealed,
    failed,
  };
  const top = Math.max(...players.map((p) => p.score));
  return {
    ...room,
    phase: "reveal",
    health: after,
    seed: null,
    commit: null,
    players: players.map((p) => ({ ...p, submitted: null })),
    deadline: now + REVEAL_MS,
    logs: [...room.logs, log],
    winnerIds: complete
      ? players.filter((p) => p.score === top).map((p) => p.id)
      : [],
    gameEnded: complete,
  };
}

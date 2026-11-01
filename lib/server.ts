import { env } from "cloudflare:workers";
import {
  ACTIVE_PLAYER_MS,
  RECONNECT_GRACE_MS,
  beginGame,
  beginNextRound,
  createRoom,
  finishGame,
  MAX_ROUNDS,
  resetForRematch,
  resolveRound,
  scoreBreakdownFor,
  shortenDeadlineWhenLocked,
  transferHostIfAbsent,
  validateAction,
  visibleLogForPlayer,
  normalizeNicknameInput,
  type Player,
  type Room,
} from "./game";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const db = () => {
  if (!env.DB) throw new Error("Room database is unavailable.");
  return env.DB;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function jsonError(error: unknown): Response {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (status === 500) console.error(error);
  return Response.json(
    { error: status === 500 ? "Server error. Please try again." : message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export async function readBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > 2048)
    throw new ApiError(413, "Request is too large.");
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw 0;
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "Invalid request body.");
  }
}
export function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "Enter a nickname.");
  const name = normalizeNicknameInput(value);
  if (name.length < 2 || name.length > 16 || !/^[\p{L}\p{N} ._-]+$/u.test(name))
    throw new ApiError(400, "Nickname must be 2–16 letters or numbers.");
  return name;
}
export function cleanCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
    throw new ApiError(400, "Room code must be six characters.");
  return code;
}
export function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
export function makeToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function newSeed() {
  const seed = makeToken();
  return { seed, commit: await hash(seed) };
}
export function newPlayer(
  name: string,
  tokenHash: string,
  now: number,
): Player {
  return {
    id: crypto.randomUUID(),
    tokenHash,
    name,
    ready: false,
    score: 0,
    battery: 4,
    objective: "engineer",
    stats: { repair: 0, shield: 0, investigate: 0, sabotage: 0 },
    submitted: null,
    lastSeen: now,
    lastCommand: 0,
  };
}
type Row = { state: string; version: number };
async function load(code: string): Promise<Row> {
  const row = await db()
    .prepare("SELECT state, version FROM rooms WHERE code = ?")
    .bind(code)
    .first<Row>();
  if (!row) throw new ApiError(404, "Room not found.");
  return row;
}
export async function mutateRoom<T>(
  code: string,
  fn: (room: Room) => Promise<{ room: Room; result: T } | null>,
): Promise<{ room: Room; result: T | null }> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const row = await load(code);
    const current = JSON.parse(row.state) as Room;
    const change = await fn(current);
    if (!change) return { room: current, result: null };
    const saved = await db()
      .prepare(
        "UPDATE rooms SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?",
      )
      .bind(JSON.stringify(change.room), Date.now(), code, row.version)
      .run();
    if (saved.meta.changes === 1) return change;
  }
  throw new ApiError(409, "The room changed at the same time. Please retry.");
}
export async function advanceRoom(code: string): Promise<Room> {
  const updated = await mutateRoom(code, async (original) => {
    let room = original;
    let changed = false;
    const now = Date.now();
    const transferred = transferHostIfAbsent(room, now);
    if (transferred !== room) {
      room = transferred;
      changed = true;
    }
    for (let i = 0; i < 15; i++) {
      if (!room.deadline || now < room.deadline) break;
      if (room.phase === "decision") {
        room = resolveRound(room, room.deadline);
        changed = true;
      } else if (room.phase === "reveal") {
        if (room.gameEnded || room.round >= MAX_ROUNDS || room.health === 0) {
          room = finishGame(room);
        } else {
          const next = await newSeed();
          room = beginNextRound(room, next.seed, next.commit, room.deadline);
        }
        changed = true;
      } else break;
    }
    return changed ? { room, result: null } : null;
  });
  return updated.room;
}
export async function createNewRoom(name: string, request: Request) {
  await limitRequest(request, "create", 12);
  const now = Date.now();
  const token = makeToken();
  const player = newPlayer(name, await hash(token), now);
  await db()
    .prepare("DELETE FROM rooms WHERE updated_at < ?")
    .bind(now - 48 * 60 * 60 * 1000)
    .run();
  for (let i = 0; i < 8; i++) {
    const code = makeCode();
    const room = createRoom(code, player, now);
    const inserted = await db()
      .prepare(
        "INSERT OR IGNORE INTO rooms (code, version, state, updated_at) VALUES (?, 1, ?, ?)",
      )
      .bind(code, JSON.stringify(room), now)
      .run();
    if (inserted.meta.changes === 1) return { room, token };
  }
  throw new ApiError(500, "Could not create a unique room.");
}
export async function joinRoom(code: string, name: string, request: Request) {
  await limitRequest(request, "join", 80);
  const token = makeToken();
  const tokenHash = await hash(token);
  const updated = await mutateRoom(code, async (room) => {
    if (room.phase !== "lobby")
      throw new ApiError(409, "This game has already started.");
    if (room.players.length >= 8) throw new ApiError(409, "This room is full.");
    if (
      room.players.some(
        (p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new ApiError(409, "That nickname is already in use.");
    const player = newPlayer(name, tokenHash, Date.now());
    return {
      room: { ...room, players: [...room.players, player] },
      result: player.id,
    };
  });
  return { room: updated.room, token, playerId: updated.result };
}
export async function getAuthenticatedRoom(
  code: string,
  token: string,
): Promise<{ room: Room; player: Player }> {
  if (!token || token.length !== 64)
    throw new ApiError(401, "Your player pass is missing. Rejoin the room.");
  const room = await advanceRoom(code);
  const tokenHash = await hash(token);
  const player = room.players.find((p) => p.tokenHash === tokenHash);
  if (!player) throw new ApiError(401, "Your player pass is invalid.");
  return { room, player };
}
export async function commandRoom(
  code: string,
  token: string,
  body: Record<string, unknown>,
) {
  await advanceRoom(code);
  const tokenHash = await hash(token);
  const now = Date.now();
  const updated = await mutateRoom(code, async (room) => {
    const index = room.players.findIndex((p) => p.tokenHash === tokenHash);
    if (index < 0) throw new ApiError(401, "Your player pass is invalid.");
    const player = room.players[index];
    const type = body.type;
    if (type === "heartbeat" && now - player.lastSeen < 8_000) return null;
    if (type !== "heartbeat" && now - player.lastCommand < 250)
      throw new ApiError(
        429,
        "Please wait a moment before changing your plan.",
      );
    const players = room.players.map((p) => ({ ...p }));
    players[index].lastSeen = now;
    if (type !== "heartbeat") players[index].lastCommand = now;
    if (type === "ready") {
      if (room.phase !== "lobby")
        throw new ApiError(409, "The lobby has closed.");
      players[index].ready = !player.ready;
    } else if (type === "start") {
      if (player.id !== room.hostId)
        throw new ApiError(403, "Only the host can start.");
      if (
        room.phase !== "lobby" ||
        room.players.length < 3 ||
        room.players.some((p) => !p.ready)
      )
        throw new ApiError(409, "Three to eight ready players are needed.");
      const next = await newSeed();
      return {
        room: beginGame(
          { ...room, players },
          next.seed,
          next.commit,
          makeToken(),
          now,
        ),
        result: null,
      };
    } else if (type === "kick") {
      if (room.phase !== "lobby" || player.id !== room.hostId)
        throw new ApiError(403, "Only the host can remove a lobby player.");
      const target = body.playerId;
      if (
        typeof target !== "string" ||
        target === player.id ||
        !players.some((p) => p.id === target)
      )
        throw new ApiError(400, "Choose another lobby player.");
      return {
        room: { ...room, players: players.filter((p) => p.id !== target) },
        result: null,
      };
    } else if (type === "submit") {
      if (room.phase !== "decision" || !room.deadline || now >= room.deadline)
        throw new ApiError(409, "The decision window is closed.");
      try {
        players[index].submitted = validateAction(body.action, player.battery);
      } catch (error) {
        throw new ApiError(
          400,
          error instanceof Error ? error.message : "Invalid action.",
        );
      }
    } else if (type === "rematch") {
      if (player.id !== room.hostId)
        throw new ApiError(403, "Only the host can start a rematch.");
      if (room.phase !== "finished")
        throw new ApiError(409, "The mission is still active.");
      return {
        room: resetForRematch({ ...room, players }, now),
        result: null,
      };
    } else if (type !== "heartbeat")
      throw new ApiError(400, "Unknown command.");
    return {
      room: shortenDeadlineWhenLocked({ ...room, players }, now),
      result: null,
    };
  });
  return updated.room;
}
export function viewRoom(room: Room, me: Player) {
  const now = Date.now();
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    health: room.health,
    maxHealth: room.maxHealth,
    event: room.event,
    commit: room.commit,
    deadline: room.deadline,
    serverTime: now,
    logs: room.logs.map((log) =>
      visibleLogForPlayer(log, me.id, room.phase === "finished"),
    ),
    winnerIds: room.winnerIds,
    ...(room.phase === "finished" ? { objectiveSeed: room.objectiveSeed } : {}),
    me: {
      id: me.id,
      battery: me.battery,
      objective: me.objective,
      action: me.submitted,
      pendingSabotageReward: room.gameEnded ? 0 : me.stats.sabotage * 3,
    },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      ...(room.phase === "finished" || p.id === me.id
        ? { score: p.score }
        : {}),
      submitted: !!p.submitted,
      connected: now - p.lastSeen < ACTIVE_PLAYER_MS,
      presence:
        now - p.lastSeen < ACTIVE_PLAYER_MS
          ? "connected"
          : now - p.lastSeen < RECONNECT_GRACE_MS
            ? "reconnecting"
            : "offline",
      ...(room.phase === "finished"
        ? {
            objective: p.objective,
            scoreBreakdown: scoreBreakdownFor(room, p),
          }
        : {}),
    })),
  };
}
async function limitRequest(request: Request, type: string, max: number) {
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("x-real-ip") ??
    "local";
  const key = `${type}:${await hash(ip)}`;
  const now = Date.now();
  const window = 60 * 60 * 1000;
  await db()
    .prepare(
      "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = CASE WHEN ? - window_start > ? THEN ? ELSE window_start END, count = CASE WHEN ? - window_start > ? THEN 1 ELSE count + 1 END",
    )
    .bind(key, now, now, window, now, now, window)
    .run();
  const row = await db()
    .prepare("SELECT count FROM rate_limits WHERE key = ?")
    .bind(key)
    .first<{ count: number }>();
  if (row && row.count > max)
    throw new ApiError(429, "Too many room attempts. Try again later.");
}

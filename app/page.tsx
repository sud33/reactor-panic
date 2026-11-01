"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BatteryCharging,
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Eye,
  Gauge,
  LogOut,
  Radio,
  RotateCcw,
  Shield,
  Skull,
  Sparkles,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import {
  actionCost,
  EMPTY_ACTION,
  EVENT_INFO,
  exposureMessage,
  limitNicknameInput,
  MAX_ROUNDS,
  normalizeNicknameInput,
  OBJECTIVE_INFO,
  savedSeatMatchesName,
  type Action,
  type EventId,
  type Objective,
  type PlayerScoreBreakdown,
  type VisibleRoundLog,
} from "../lib/game";

type PlayerView = {
  id: string;
  name: string;
  ready: boolean;
  score?: number;
  submitted: boolean;
  connected: boolean;
  presence: "connected" | "reconnecting" | "offline";
  objective?: Objective;
  scoreBreakdown?: PlayerScoreBreakdown;
};
type RoomView = {
  code: string;
  hostId: string;
  phase: "lobby" | "decision" | "reveal" | "finished";
  round: number;
  health: number;
  maxHealth: number;
  event: EventId | null;
  commit: string | null;
  deadline: number | null;
  serverTime: number;
  logs: VisibleRoundLog[];
  winnerIds: string[];
  me: {
    id: string;
    battery: number;
    objective: Objective;
    action: Action | null;
    pendingSabotageReward: number;
  };
  players: PlayerView[];
};
type Envelope = { code: string; token: string; room: RoomView };
type SavedSeatChoice = {
  code: string;
  token: string;
  room: RoomView;
  savedName: string;
  requestedName: string;
};
const actions = [
  {
    key: "repair",
    label: "Repair",
    Icon: Wrench,
    tone: "mint",
    text: "Restore 2 reactor health. Earn 2 points per energy.",
  },
  {
    key: "shield",
    label: "Shield",
    Icon: Shield,
    tone: "blue",
    text: "Block 2 damage. Earn 1–2 points per energy.",
  },
  {
    key: "investigate",
    label: "Investigate",
    Icon: Eye,
    tone: "purple",
    text: "Earn 2 points. Each energy adds 8% exposure chance (30% base, 75% max).",
  },
  {
    key: "recharge",
    label: "Recharge",
    Icon: BatteryCharging,
    tone: "yellow",
    text: "Gain 2 extra energy next round. No immediate points.",
  },
  {
    key: "sabotage",
    label: "Sabotage",
    Icon: Skull,
    tone: "red",
    text: "Costs 2 energy. A 3-point reward stays pending and pays only if the station survives.",
  },
] as const;
function errorText(data: unknown) {
  return data &&
    typeof data === "object" &&
    "error" in data &&
    typeof data.error === "string"
    ? data.error
    : "Something went wrong. Please retry.";
}
function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
function Initials({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1
      ? `${words[0][0]}${words[1][0]}`
      : words[0]?.slice(0, 2) || "?";
  return (
    <span className="avatar" aria-hidden="true">
      {initials.toUpperCase()}
    </span>
  );
}
function Reactor({
  health,
  maxHealth,
  compact = false,
}: {
  health: number;
  maxHealth: number;
  compact?: boolean;
}) {
  const pct = maxHealth ? Math.round((health / maxHealth) * 100) : 100;
  return (
    <div
      className={`reactor-graphic ${compact ? "compact" : ""} ${pct <= 30 ? "danger" : ""}`}
    >
      <div className="reactor-orbit orbit-a" />
      <div className="reactor-orbit orbit-b" />
      <div className="reactor-core">
        <Zap size={compact ? 20 : 38} fill="currentColor" />
      </div>
      {!compact && (
        <div className="reactor-readout">
          <strong>{pct}%</strong>
          <span>CORE STABILITY</span>
        </div>
      )}
    </div>
  );
}
function summary(a: Action) {
  return (
    (Object.entries(a) as [keyof Action, number][])
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(" · ") || "Held energy"
  );
}
function ScorePanel({
  players,
  meId,
  phase,
  pendingSabotageReward,
}: {
  players: PlayerView[];
  meId: string;
  phase: RoomView["phase"];
  pendingSabotageReward: number;
}) {
  return (
    <section className="panel score-card">
      <div className="score-head">
        <div>
          <span className="section-kicker">CAPTAIN BOARD</span>
          <h3>Crew status</h3>
        </div>
        <Users size={20} />
      </div>
      <div className="score-list">
        {players.map((p, i) => (
          <div className="score-row" key={p.id}>
            <span className="score-rank">{String(i + 1).padStart(2, "0")}</span>
            <Initials name={p.name} />
            <div>
              <strong>
                {p.name}
                {p.id === meId && " · you"}
              </strong>
              <small>
                {phase === "decision"
                  ? p.submitted
                    ? "Plan locked"
                    : p.presence === "connected"
                      ? "Deciding…"
                      : p.presence === "reconnecting"
                        ? "Reconnecting…"
                        : "Offline"
                  : p.presence === "connected"
                    ? "Connected"
                    : p.presence === "reconnecting"
                      ? "Reconnecting…"
                      : "Offline"}
              </small>
            </div>
            <b aria-label={p.id === meId ? "Your score" : "Hidden score"}>
              {p.id === meId ? (
                <>
                  {p.score}
                  {pendingSabotageReward > 0 && (
                    <small> (+{pendingSabotageReward} pending)</small>
                  )}
                </>
              ) : (
                "••"
              )}
            </b>
          </div>
        ))}
      </div>
      <div className="score-foot">
        Only your score is visible until the mission ends <Radio size={15} />
      </div>
    </section>
  );
}

export default function Home() {
  const [room, setRoom] = useState<RoomView | null>(null),
    [token, setToken] = useState(""),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [mode, setMode] = useState<"create" | "join">("create");
  const [action, setAction] = useState<Action>({ ...EMPTY_ACTION }),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [now, setNow] = useState(0),
    [skew, setSkew] = useState(0),
    [showRules, setShowRules] = useState(false),
    [verify, setVerify] = useState<"verified" | "failed" | null>(null),
    [savedSeatChoice, setSavedSeatChoice] =
      useState<SavedSeatChoice | null>(null);
  const roundRef = useRef(0),
    tokenRef = useRef(""),
    roomRef = useRef<RoomView | null>(null);
  const acceptRoom = useCallback((next: RoomView) => {
    const previous = roomRef.current;
    setSkew(next.serverTime - Date.now());
    setRoom(next);
    roomRef.current = next;
    if (next.round !== roundRef.current) {
      roundRef.current = next.round;
      setAction(next.me.action ?? { ...EMPTY_ACTION });
      setMessage("");
    }
    if (previous && previous.phase !== next.phase) setMessage("");
  }, []);
  const fetchRoom = useCallback(
    async (roomCode: string, playerToken: string, quiet = false) => {
      try {
        const response = await fetch(`/api/rooms/${roomCode}`, {
          headers: { "x-player-token": playerToken },
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(errorText(data));
        acceptRoom(data as RoomView);
        if (!quiet) setMessage("");
      } catch (error) {
        if (!quiet)
          setMessage(
            error instanceof Error ? error.message : "Could not connect.",
          );
      }
    },
    [acceptRoom],
  );
  const heartbeat = useCallback(async () => {
    const current = roomRef.current;
    const playerToken = tokenRef.current;
    if (!current || !playerToken) return;
    try {
      const response = await fetch(`/api/rooms/${current.code}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-player-token": playerToken,
        },
        body: JSON.stringify({ type: "heartbeat" }),
      });
      if (response.ok) acceptRoom((await response.json()) as RoomView);
    } catch {
      // Polling and the next visibility event will retry without interrupting play.
    }
  }, [acceptRoom]);
  useEffect(() => {
    const roomCode =
      new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
    if (roomCode) {
      const timer = window.setTimeout(() => {
        setCode(roomCode);
        setMode("join");
        const saved = localStorage.getItem(`reactor-panic:${roomCode}`);
        if (saved) {
          tokenRef.current = saved;
          setToken(saved);
          void fetchRoom(roomCode, saved);
        }
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [fetchRoom]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!roomRef.current || !token) return;
    const poll = window.setInterval(() => {
      if (roomRef.current)
        void fetchRoom(roomRef.current.code, tokenRef.current, true);
    }, 1500);
    const beat = window.setInterval(() => {
      if (roomRef.current) void heartbeat();
    }, 10_000);
    const visible = () => {
      if (document.visibilityState === "visible" && roomRef.current) {
        void fetchRoom(roomRef.current.code, tokenRef.current, true);
        void heartbeat();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(poll);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [room?.code, token, fetchRoom, heartbeat]);
  const verificationSeed = room?.logs.at(-1)?.seed;
  const verificationCommit = room?.logs.at(-1)?.commit;
  useEffect(() => {
    if (!verificationSeed || !verificationCommit) return;
    let active = true;
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(verificationSeed))
      .then((buffer) => {
        const digest = Array.from(new Uint8Array(buffer), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        if (active)
          setVerify(digest === verificationCommit ? "verified" : "failed");
      });
    return () => {
      active = false;
    };
  }, [verificationSeed, verificationCommit]);
  function activateSeat(roomCode: string, playerToken: string, next: RoomView) {
    tokenRef.current = playerToken;
    setToken(playerToken);
    history.replaceState(null, "", `/?room=${roomCode}`);
    acceptRoom(next);
  }
  async function requestNewEntry(
    entryMode: "create" | "join",
    nickname: string,
    roomCode: string,
  ) {
    const path =
      entryMode === "create" ? "/api/rooms" : `/api/rooms/${roomCode}`;
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: entryMode === "join" ? "join" : undefined,
        name: nickname,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(errorText(data));
    const result = data as Envelope;
    localStorage.setItem(`reactor-panic:${result.code}`, result.token);
    activateSeat(result.code, result.token, result.room);
  }
  async function enterRoom(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const normalizedName = normalizeNicknameInput(name);
      setName(normalizedName);
      const clean = code.trim().toUpperCase();
      if (mode === "join") {
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(clean))
          throw new Error("Enter a valid six-character room code.");
        const saved = localStorage.getItem(`reactor-panic:${clean}`);
        if (saved) {
          const reconnect = await fetch(`/api/rooms/${clean}`, {
            headers: { "x-player-token": saved },
            cache: "no-store",
          });
          if (reconnect.ok) {
            const existing = (await reconnect.json()) as RoomView;
            const savedName =
              existing.players.find((p) => p.id === existing.me.id)?.name ??
              "saved player";
            if (!savedSeatMatchesName(normalizedName, savedName)) {
              setSavedSeatChoice({
                code: clean,
                token: saved,
                room: existing,
                savedName,
                requestedName: normalizedName,
              });
              return;
            }
            activateSeat(clean, saved, existing);
            return;
          }
          localStorage.removeItem(`reactor-panic:${clean}`);
        }
      }
      await requestNewEntry(mode, normalizedName, clean);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not enter room.",
      );
    } finally {
      setPending(false);
    }
  }
  function continueSavedSeat() {
    if (!savedSeatChoice) return;
    const choice = savedSeatChoice;
    setSavedSeatChoice(null);
    activateSeat(choice.code, choice.token, choice.room);
  }
  async function joinAsNewPlayer() {
    if (!savedSeatChoice) return;
    const choice = savedSeatChoice;
    setPending(true);
    setMessage("");
    try {
      await requestNewEntry("join", choice.requestedName, choice.code);
      setSavedSeatChoice(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not join the room.",
      );
    } finally {
      setPending(false);
    }
  }
  async function sendCommand(body: Record<string, unknown>, quiet = false) {
    const current = roomRef.current;
    if (!current || !tokenRef.current) return;
    if (!quiet) {
      setPending(true);
      setMessage("");
    }
    try {
      const response = await fetch(`/api/rooms/${current.code}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-player-token": tokenRef.current,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(errorText(data));
      acceptRoom(data as RoomView);
    } catch (error) {
      if (!quiet)
        setMessage(error instanceof Error ? error.message : "Command failed.");
    } finally {
      if (!quiet) setPending(false);
    }
  }
  function leaveRoom() {
    if (room) {
      history.replaceState(null, "", "/");
    }
    setRoom(null);
    roomRef.current = null;
    tokenRef.current = "";
    setToken("");
    roundRef.current = 0;
    setSavedSeatChoice(null);
    setMessage("");
  }
  async function copyInvite() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/?room=${room.code}`,
      );
      setMessage("Invitation link copied.");
    } catch {
      setMessage("Copy the room code to invite friends.");
    }
  }
  function adjust(key: keyof Action, delta: number) {
    setAction((current) => {
      const next = {
        ...current,
        [key]: Math.max(
          0,
          Math.min(key === "sabotage" ? 1 : 6, current[key] + delta),
        ),
      };
      return actionCost(next) <= (room?.me.battery ?? 0) ? next : current;
    });
  }
  const currentServerTime = now ? now + skew : (room?.serverTime ?? 0);
  const me = room?.players.find((p) => p.id === room.me.id),
    isHost = room?.hostId === room?.me.id,
    seconds = room?.deadline
      ? Math.max(0, Math.ceil((room.deadline - currentServerTime) / 1000))
      : 0,
    sorted = room
      ? room.phase === "finished"
        ? [...room.players].sort(
            (a, b) =>
              (b.score ?? 0) - (a.score ?? 0) ||
              a.name.localeCompare(b.name),
          )
        : [...room.players]
      : [],
    latest = room?.logs.at(-1),
    totalCost = actionCost(action);
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Activity size={20} strokeWidth={2.5} />
          </span>
          REACTOR<span className="brand-accent">PANIC</span>
        </div>
        <div className="topbar-right">
          <span className="live-indicator">
            <i /> LIVE STATION
          </span>
          <button
            className="icon-button"
            onClick={() => setShowRules(true)}
            aria-label="How to play"
          >
            <CircleHelp size={20} />
          </button>
        </div>
      </header>
      {!room ? (
        <section className="landing">
          <div className="landing-copy">
            <span className="eyebrow">
              <i /> 07 ROUNDS · 03–08 PLAYERS · 01 REACTOR
            </span>
            <h1>
              Keep the lights on.
              <br />
              <em>Take the captain&apos;s chair.</em>
            </h1>
            <p className="lead">
              A shared reactor is failing. Your crew must save it, but only one
              of you earns the captain&apos;s title. Make secret plans, read the
              room, and survive seven rounds.
            </p>
            <div className="feature-strip">
              <span>
                <Shield size={17} /> Cooperate to survive
              </span>
              <span>
                <Eye size={17} /> Decide in secret
              </span>
              <span>
                <Sparkles size={17} /> Win your own way
              </span>
            </div>
          </div>
          <div className="landing-art" aria-hidden="true">
            <div className="art-label">ORBITAL STATION / RP-07</div>
            <Reactor health={100} maxHealth={100} />
            <div className="art-bottom">
              <span>
                CORE OUTPUT
                <br />
                <strong>UNSTABLE</strong>
              </span>
              <span>▂▄▆█▆▄▂</span>
            </div>
          </div>
          <div className="entry-card">
            <span className="section-kicker">START TRANSMISSION</span>
            <h2>Enter the station</h2>
            <p>No account. Just a nickname and your crew.</p>
            <div className="mode-tabs" role="tablist" aria-label="Room options">
              <button
                className={mode === "create" ? "active" : ""}
                onClick={() => {
                  setMode("create");
                  setSavedSeatChoice(null);
                }}
                role="tab"
                aria-selected={mode === "create"}
              >
                Create room
              </button>
              <button
                className={mode === "join" ? "active" : ""}
                onClick={() => {
                  setMode("join");
                  setSavedSeatChoice(null);
                }}
                role="tab"
                aria-selected={mode === "join"}
              >
                Join room
              </button>
            </div>
            <form onSubmit={enterRoom} className="entry-form">
              <label>
                YOUR CALLSIGN
                <input
                  autoComplete="nickname"
                  maxLength={16}
                  value={name}
                  onChange={(e) => setName(limitNicknameInput(e.target.value))}
                  onBlur={() => setName(normalizeNicknameInput(name))}
                  placeholder="Choose a nickname"
                  aria-describedby="nickname-limit"
                  required
                />
                <span className="input-meta" id="nickname-limit">
                  <span>2–16 characters</span>
                  <span>{normalizeNicknameInput(name).length} / 16</span>
                </span>
              </label>
              {mode === "join" && (
                <label>
                  ROOM CODE
                  <input
                    className="code-input"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    required
                  />
                </label>
              )}
              <button
                className="primary-button"
                type="submit"
                disabled={pending}
              >
                {pending
                  ? "Connecting…"
                  : mode === "create"
                    ? "Create private room"
                    : "Join the crew"}
                <ArrowRight size={18} />
              </button>
            </form>
            {savedSeatChoice && (
              <section className="saved-seat-card" aria-live="polite">
                <strong>Saved seat found</strong>
                <p>
                  This browser already belongs to {savedSeatChoice.savedName} in
                  room {savedSeatChoice.code}. Choose which identity to use.
                </p>
                <div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={pending}
                    onClick={continueSavedSeat}
                  >
                    Continue as {savedSeatChoice.savedName}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={pending}
                    onClick={() => void joinAsNewPlayer()}
                  >
                    Join as {savedSeatChoice.requestedName}
                  </button>
                </div>
              </section>
            )}
            <p className="entry-foot">
              Private by room code · No login required
            </p>
          </div>
        </section>
      ) : (
        <div className="game-layout">
          <div className="game-head">
            <div>
              <span className="section-kicker">
                STATION RP-07 /{" "}
                {room.phase === "lobby"
                  ? "ASSEMBLY"
                  : `ROUND ${String(room.round).padStart(2, "0")}`}
              </span>
              <h1>
                {room.phase === "lobby"
                  ? "Crew assembly"
                  : room.phase === "decision"
                    ? "Make your move"
                    : room.phase === "reveal"
                      ? "The reactor answers"
                      : "Mission complete"}
              </h1>
            </div>
            <div className="room-tools">
              <span className="room-code">
                ROOM <strong>{room.code}</strong>
              </span>
              <button className="secondary-button small" onClick={copyInvite}>
                <Clipboard size={16} /> Invite
              </button>
              <button
                className="icon-button"
                onClick={leaveRoom}
                title="Return home (your reconnect pass stays saved)"
                aria-label="Return home"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
          {room.phase !== "lobby" && (
            <div className="status-row">
              <div className="status-card reactor-status">
                <Reactor
                  health={room.health}
                  maxHealth={room.maxHealth}
                  compact
                />
                <div>
                  <span>REACTOR HEALTH</span>
                  <strong>
                    {room.health}
                    <small> / {room.maxHealth}</small>
                  </strong>
                </div>
                <div className="health-track">
                  <i
                    style={{
                      width: `${room.maxHealth ? (room.health / room.maxHealth) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div className="status-card">
                <span>MISSION PROGRESS</span>
                <strong>
                  {room.round}
                  <small> / {MAX_ROUNDS}</small>
                </strong>
                <div className="round-dots">
                  {Array.from({ length: MAX_ROUNDS }, (_, i) => (
                    <i key={i} className={i < room.round ? "on" : ""} />
                  ))}
                </div>
              </div>
              <div
                className={`status-card timer-card ${seconds <= 15 && room.phase === "decision" ? "urgent" : ""}`}
              >
                <span>
                  {room.phase === "decision"
                    ? "DECISION WINDOW"
                    : room.phase === "reveal"
                      ? room.round === MAX_ROUNDS || room.health === 0
                        ? "FINAL RESULTS IN"
                        : "NEXT ROUND IN"
                      : "FINAL STATUS"}
                </span>
                <strong>
                  {room.phase === "finished" ? "ENDED" : formatTime(seconds)}
                </strong>
                <small>
                  {room.phase === "decision"
                    ? room.players
                        .filter((p) => p.presence === "connected")
                        .every((p) => p.submitted)
                      ? "All active plans locked · resolving shortly"
                      : "Plans stay hidden until time runs out"
                    : room.phase === "reveal"
                      ? "Review the station log"
                      : room.health > 0
                        ? "Station survived"
                        : "Reactor failed"}
                </small>
              </div>
            </div>
          )}
          {room.phase === "lobby" && (
            <div className="content-grid">
              <section className="panel main-panel">
                <div className="panel-head">
                  <span className="section-kicker">01 / LOBBY</span>
                  <h2>Gather your crew</h2>
                  <p>
                    Share the invite link. Everyone must ready up before the
                    host can launch.
                  </p>
                </div>
                <div className="invite-banner">
                  <Radio size={26} />
                  <div>
                    <strong>Secure frequency established</strong>
                    <span>Send this room code to 2–7 friends.</span>
                  </div>
                  <button onClick={copyInvite}>
                    <Clipboard size={17} /> Copy link
                  </button>
                </div>
                <div className="list-heading">
                  <span>CREW ROSTER</span>
                  <span>{room.players.length} / 8</span>
                </div>
                <div className="roster">
                  {room.players.map((p) => (
                    <div className="roster-row" key={p.id}>
                      <Initials name={p.name} />
                      <div className="roster-name">
                        <strong>
                          {p.name}{" "}
                          {p.id === room.me.id && (
                            <span className="you-tag">YOU</span>
                          )}
                        </strong>
                        <small>
                          {p.id === room.hostId
                            ? "Room host"
                            : p.presence === "connected"
                              ? "Connected"
                              : p.presence === "reconnecting"
                                ? "Reconnecting…"
                                : "Offline"}
                        </small>
                      </div>
                      <span className={`ready-pill ${p.ready ? "ready" : ""}`}>
                        {p.ready ? (
                          <>
                            <Check size={14} /> READY
                          </>
                        ) : (
                          "WAITING"
                        )}
                      </span>
                      {isHost && p.id !== room.me.id && (
                        <button
                          className="remove-button"
                          onClick={() =>
                            void sendCommand({ type: "kick", playerId: p.id })
                          }
                          aria-label={`Remove ${p.name}`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="lobby-actions">
                  <button
                    className={
                      me?.ready ? "secondary-button" : "primary-button"
                    }
                    disabled={pending}
                    onClick={() => void sendCommand({ type: "ready" })}
                  >
                    {me?.ready ? (
                      <>
                        <Check size={18} /> You&apos;re ready · undo
                      </>
                    ) : (
                      <>
                        Ready up <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                  {isHost && (
                    <button
                      className="primary-button launch"
                      disabled={
                        pending ||
                        room.players.length < 3 ||
                        room.players.some((p) => !p.ready)
                      }
                      onClick={() => void sendCommand({ type: "start" })}
                    >
                      Launch mission <Zap size={18} />
                    </button>
                  )}
                </div>
              </section>
              <aside className="panel side-panel">
                <span className="section-kicker">MISSION BRIEF</span>
                <h3>
                  Seven rounds.
                  <br />
                  One captain.
                </h3>
                <p>
                  Spend your energy on repair, defense, investigation, recharge,
                  or risky sabotage. Each station event changes what works best.
                </p>
                <div className="brief-list">
                  <span>
                    <Wrench size={18} /> Keep the reactor alive
                  </span>
                  <span>
                    <Gauge size={18} /> Build your captain score
                  </span>
                  <span>
                    <Eye size={18} /> Conceal your plan
                  </span>
                </div>
                <button
                  className="text-button"
                  onClick={() => setShowRules(true)}
                >
                  Read full rules <ArrowRight size={16} />
                </button>
              </aside>
            </div>
          )}
          {room.phase === "decision" && (
            <div className="content-grid">
              <section className="panel main-panel">
                <div className="event-banner">
                  <div className="event-icon">
                    <Sparkles size={24} />
                  </div>
                  <div>
                    <span className="section-kicker">
                      INCOMING STATION EVENT
                    </span>
                    <h2>{room.event && EVENT_INFO[room.event].title}</h2>
                    <p>{room.event && EVENT_INFO[room.event].detail}</p>
                  </div>
                  <span className="event-damage">
                    {room.event &&
                      EVENT_INFO[room.event].damage +
                        Math.floor(room.players.length / 3)}{" "}
                    <small>BASE DAMAGE</small>
                  </span>
                </div>
                <div className="planner-head">
                  <div>
                    <span className="section-kicker">02 / SECRET DECISION</span>
                    <h2>Allocate your energy</h2>
                    <p>Only you can see your plan until the round resolves.</p>
                  </div>
                  <div className="energy-meter">
                    <Zap size={20} fill="currentColor" />
                    <strong>{room.me.battery - totalCost}</strong>
                    <span>LEFT</span>
                  </div>
                </div>
                <div className="action-list">
                  {actions.map((item) => {
                    const Icon = item.Icon;
                    return (
                      <div className={`action-row ${item.tone}`} key={item.key}>
                        <div className="action-icon">
                          <Icon size={22} />
                        </div>
                        <div className="action-copy">
                          <strong>
                            {item.label}
                            <small>
                              {item.key === "sabotage"
                                ? " · 2 ENERGY"
                                : " · 1 ENERGY"}
                            </small>
                          </strong>
                          <p>{item.text}</p>
                        </div>
                        <div className="stepper">
                          <button
                            onClick={() => adjust(item.key, -1)}
                            disabled={action[item.key] === 0}
                            aria-label={`Decrease ${item.label}`}
                          >
                            −
                          </button>
                          <output aria-label={`${item.label} energy`}>
                            {action[item.key]}
                          </output>
                          <button
                            onClick={() => adjust(item.key, 1)}
                            disabled={
                              action[item.key] >=
                                (item.key === "sabotage" ? 1 : 6) ||
                              totalCost + (item.key === "sabotage" ? 2 : 1) >
                                room.me.battery
                            }
                            aria-label={`Increase ${item.label}`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="plan-footer">
                  <div>
                    <strong>
                      {totalCost} / {room.me.battery} energy assigned
                    </strong>
                    <span>
                      Unused energy carries over, plus 2 base regeneration.
                    </span>
                  </div>
                  <button
                    className="primary-button"
                    disabled={pending}
                    onClick={() => void sendCommand({ type: "submit", action })}
                  >
                    {room.me.action ? "Update secret plan" : "Lock secret plan"}{" "}
                    <ArrowRight size={18} />
                  </button>
                </div>
              </section>
              <aside className="side-column">
                <section className="panel objective-card">
                  <span className="section-kicker">YOUR SECRET OBJECTIVE</span>
                  <div className="objective-icon">
                    <Sparkles size={23} />
                  </div>
                  <h3>{OBJECTIVE_INFO[room.me.objective].title}</h3>
                  <p>{OBJECTIVE_INFO[room.me.objective].detail}</p>
                  <span className="private-note">
                    <Eye size={15} /> Visible only to you
                  </span>
                </section>
                <ScorePanel
                  players={sorted}
                  meId={room.me.id}
                  phase={room.phase}
                  pendingSabotageReward={room.me.pendingSabotageReward}
                />
              </aside>
            </div>
          )}
          {room.phase === "reveal" && latest && (
            <div className="content-grid">
              <section
                className="panel main-panel reveal-panel"
                key={latest.round}
              >
                <div className="reveal-intro">
                  <span className="section-kicker">
                    03 / ROUND {latest.round} RESOLUTION
                  </span>
                  <h2>
                    {latest.failed
                      ? "The core went dark"
                      : latest.after < latest.before
                        ? "The station takes a hit"
                        : "The crew holds steady"}
                  </h2>
                  <p>
                    Crew totals are public. Only your plan and exposed sabotage
                    are identified below.
                  </p>
                </div>
                <div className="resolution-flow">
                  <div>
                    <span>START</span>
                    <strong>{latest.before}</strong>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <span>REPAIRS</span>
                    <strong className="positive">+{latest.repaired}</strong>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <span>HIT · SHIELDED</span>
                    <strong className="negative">
                      −
                      {Math.max(
                        0,
                        latest.eventDamage +
                          latest.sabotageDamage -
                          latest.shieldAbsorbed,
                      )}
                    </strong>
                  </div>
                  <ArrowRight size={18} />
                  <div className="flow-result">
                    <span>REACTOR</span>
                    <strong>{latest.after}</strong>
                  </div>
                </div>
                <div className="breakdown">
                  <span>
                    Event damage <strong>{latest.eventDamage}</strong>
                  </span>
                  <span>
                    Sabotage impact <strong>{latest.sabotageDamage}</strong>
                  </span>
                  <span>
                    Damage blocked <strong>{latest.shieldAbsorbed}</strong>
                  </span>
                </div>
                <div className="list-heading">
                  <span>YOUR PLAN &amp; EXPOSED SABOTAGE</span>
                  <span>{latest.round === MAX_ROUNDS ? "FINAL ROUND" : "THIS ROUND"}</span>
                </div>
                <div className="reveal-list">
                  {latest.revealed.map((r) => (
                    <div className="reveal-row" key={r.id}>
                      <Initials name={r.name} />
                      <div>
                        <strong>{r.name}</strong>
                        <small>
                          {r.id !== room.me.id
                            ? exposureMessage(false, latest.investigationOccurred)
                            : r.autopilot
                              ? "Autopilot: safe repair, no points"
                              : summary(r.action!)}
                          {r.id === room.me.id &&
                            r.action?.sabotage === 1 &&
                            room.me.pendingSabotageReward > 0 &&
                            " · +3 pending (pays if the station survives)"}
                          {r.id === room.me.id && r.exposed &&
                            ` · ${exposureMessage(true, latest.investigationOccurred)}`}
                        </small>
                      </div>
                      {typeof r.points === "number" && (
                        <strong
                          className={r.points < 0 ? "negative" : "positive"}
                        >
                          {r.points > 0 ? "+" : ""}
                          {r.points}
                        </strong>
                      )}
                    </div>
                  ))}
                </div>
                <div className="audit-note">
                  <Check size={17} />
                  <span>
                    Random result{" "}
                    {verify === "verified"
                      ? "was locked before decisions and verified afterward"
                      : verify === "failed"
                        ? "did not match its pre-round lock"
                        : "is being verified against its pre-round lock"}
                    .
                  </span>
                  <details>
                    <summary>
                      Technical audit <ChevronDown size={14} />
                    </summary>
                    <code>{latest.seed}</code>
                    <small>SHA-256: {latest.commit}</small>
                  </details>
                </div>
              </section>
              <aside className="side-column">
                <ScorePanel
                  players={sorted}
                  meId={room.me.id}
                  phase={room.phase}
                  pendingSabotageReward={room.me.pendingSabotageReward}
                />
                <section className="panel next-card">
                  <span className="section-kicker">
                    {room.round === MAX_ROUNDS || room.health === 0
                      ? "FINAL RESULTS"
                      : "NEXT TRANSMISSION"}
                  </span>
                  <h3>{formatTime(seconds)}</h3>
                  <p>
                    {room.round === MAX_ROUNDS || room.health === 0
                      ? "Final standings and score bonuses open automatically."
                      : "The next event and energy budget arrive automatically."}
                  </p>
                </section>
              </aside>
            </div>
          )}
          {room.phase === "finished" && latest && (
            <div className="content-grid">
              <section className="panel main-panel final-panel">
                <span className="section-kicker">MISSION REPORT / FINAL</span>
                <div className="final-hero">
                  <Reactor
                    health={room.health}
                    maxHealth={room.maxHealth}
                    compact
                  />
                  <div>
                    <h2>
                      {room.health > 0 ? "Station saved." : "Reactor lost."}
                    </h2>
                    <p>
                      {room.health > 0
                        ? "The crew survived all seven rounds. The captain's chair is decided."
                        : `The reactor failed in round ${room.round}. The highest salvage score takes the captain's record.`}
                    </p>
                  </div>
                </div>
                <div className="winner-banner">
                  <span>
                    CAPTAIN{room.winnerIds.length > 1 ? "S" : ""} OF THE STATION
                  </span>
                  <strong>
                    {room.players
                      .filter((p) => room.winnerIds.includes(p.id))
                      .map((p) => p.name)
                      .join(" & ")}
                  </strong>
                </div>
                <p className="bonus-note">
                  {room.health > 0
                    ? "Final totals include pending sabotage rewards, the 3-point survival award, and any completed 5-point secret objective."
                    : "Pending sabotage rewards were dropped. Final totals include a 4-point station failure penalty for everyone and a separate 6-point penalty for anyone who sabotaged."}
                </p>
                <div className="list-heading">
                  <span>FINAL STANDINGS</span>
                  <span>CAPTAIN SCORE</span>
                </div>
                <div className="final-standings">
                  {sorted.map((p, i) => (
                    <div className="final-row" key={p.id}>
                      <span className="rank">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <Initials name={p.name} />
                      <div>
                        <strong>
                          {p.name}{" "}
                          {p.id === room.me.id && (
                            <span className="you-tag">YOU</span>
                          )}
                        </strong>
                        <small>
                          {p.objective && OBJECTIVE_INFO[p.objective].title}
                        </small>
                        {p.scoreBreakdown && (
                          <small className="score-breakdown">
                            Rounds {p.scoreBreakdown.roundPoints} ·{" "}
                            {room.health > 0
                              ? `survival +${p.scoreBreakdown.survivalBonus}`
                              : `station failure ${p.scoreBreakdown.survivalBonus}`}
                            {p.scoreBreakdown.sabotageReward > 0 &&
                              ` · sabotage reward +${p.scoreBreakdown.sabotageReward}`}
                            {p.scoreBreakdown.sabotageFailurePenalty < 0 &&
                              ` · saboteur penalty ${p.scoreBreakdown.sabotageFailurePenalty}`}
                            {` · objective +${p.scoreBreakdown.objectiveBonus} = ${p.scoreBreakdown.total}`}
                          </small>
                        )}
                      </div>
                      <strong>{p.score}</strong>
                    </div>
                  ))}
                </div>
                <details className="history-details">
                  <summary>
                    Round-by-round station log <ChevronDown size={17} />
                  </summary>
                  {room.logs.map((log) => (
                    <details className="history-row" key={log.round}>
                      <summary>
                        <span>
                          ROUND {log.round} · {EVENT_INFO[log.event].title}
                        </span>
                        <span>
                          {log.before} → {log.after} HP
                        </span>
                      </summary>
                      <code>Seed: {log.seed}</code>
                      <small>SHA-256 lock: {log.commit}</small>
                    </details>
                  ))}
                </details>
                <div className="final-actions">
                  {isHost ? (
                    <button
                      className="primary-button"
                      disabled={pending}
                      onClick={() => void sendCommand({ type: "rematch" })}
                    >
                      <RotateCcw size={17} /> Rematch with same crew
                    </button>
                  ) : (
                    <span className="rematch-note">The host can restart this room with the same crew.</span>
                  )}
                  <button className="secondary-button" onClick={leaveRoom}>
                    Create another room
                  </button>
                </div>
              </section>
              <aside className="side-column">
                <section className="panel objective-card">
                  <span className="section-kicker">YOUR ORDERS</span>
                  <h3>{OBJECTIVE_INFO[room.me.objective].title}</h3>
                  <p>{OBJECTIVE_INFO[room.me.objective].detail}</p>
                </section>
                <section className="panel next-card">
                  <span className="section-kicker">MISSION RECORD</span>
                  <h3>{room.round} / 7</h3>
                  <p>
                    Rounds completed · {room.health} reactor health remaining
                  </p>
                  <div className="audit-final">
                    <Check size={17} /> Random events were locked before each
                    decision and can be audited in the station log.
                  </div>
                </section>
              </aside>
            </div>
          )}
          <div className="feedback" role="status" aria-live="polite">
            {message ||
              (room.phase === "decision" && room.me.action
                ? "Decision locked. You can revise it until the timer ends."
                : "")}
          </div>
        </div>
      )}
      {showRules && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowRules(false);
          }}
        >
          <section
            className="rules-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
          >
            <button
              className="modal-close"
              onClick={() => setShowRules(false)}
              aria-label="Close rules"
            >
              ×
            </button>
            <span className="section-kicker">STATION MANUAL / 01</span>
            <h2 id="rules-title">How to play</h2>
            <p>
              Three to eight players share a reactor for seven 80-second
              decision rounds. The host starts when everyone is ready. Each
              player begins with four energy and can spend it secretly on any
              mix of actions.
            </p>
            <div className="rules-actions">
              {actions.map((a) => {
                const Icon = a.Icon;
                return (
                  <div key={a.key}>
                    <Icon size={18} />
                    <span>
                      <strong>{a.label}</strong> — {a.text}
                    </span>
                  </div>
                );
              })}
            </div>
            <p>
              Every round has a public event. Unspent energy carries over,
              everyone regenerates two energy, and recharge adds more, up to
              six. If someone misses a turn, autopilot repairs safely but earns
              no points.
            </p>
            <p>
              Sabotage is capped at two reactor damage per round. Exposure has a
              30% base chance, plus 8 percentage points for every investigation
              energy spent by the crew, capped at 75%. An exposed saboteur loses
              4 points. Sabotage rewards stay pending and pay only after the
              station survives all seven rounds. If the reactor fails, those
              rewards are lost, everyone loses 4 points, and anyone who
              sabotaged loses 6 more; the top score still holds the
              captain&apos;s record.
              Surviving seven rounds grants three points and may complete a
              private five-point objective.
            </p>
            <div className="rules-footer">
              <span>
                Random events are locked in before you decide and revealed
                afterward, so nobody—not even the host—can rig them.
              </span>
              <button
                className="primary-button"
                onClick={() => setShowRules(false)}
              >
                Understood <Check size={17} />
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

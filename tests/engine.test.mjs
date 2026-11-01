import test from "node:test";
import assert from "node:assert/strict";
import {
  actionCost,
  beginGame,
  beginNextRound,
  createRoom,
  EMPTY_ACTION,
  eventFor,
  exposureMessage,
  finishGame,
  limitNicknameInput,
  MAX_ROUNDS,
  normalizeNicknameInput,
  objectiveFor,
  resetForRematch,
  resolveRound,
  savedSeatMatchesName,
  scoreBreakdownFor,
  shortenDeadlineWhenLocked,
  transferHostIfAbsent,
  validateAction,
  visibleLogForPlayer,
} from "../lib/game.ts";

const makePlayer = (i) => ({
  id: `p${i}`,
  tokenHash: `hash${i}`,
  name: `Crew ${i}`,
  ready: true,
  score: 0,
  battery: 4,
  objective: "engineer",
  stats: { repair: 0, shield: 0, investigate: 0, sabotage: 0 },
  submitted: null,
  lastSeen: 0,
  lastCommand: 0,
});
function game(seed = "alpha") {
  const players = [1, 2, 3].map(makePlayer);
  const room = createRoom("ABC234", players[0], 0);
  room.players = players;
  return beginGame(room, seed, "commit", "private-objective-seed", 0);
}

test("energy validation rejects fractions, negatives, overspend and repeated sabotage", () => {
  assert.equal(
    actionCost({
      repair: 1,
      shield: 1,
      investigate: 0,
      recharge: 0,
      sabotage: 1,
    }),
    4,
  );
  assert.throws(() =>
    validateAction(
      { repair: 5, shield: 0, investigate: 0, recharge: 0, sabotage: 0 },
      4,
    ),
  );
  assert.throws(() =>
    validateAction(
      { repair: -1, shield: 0, investigate: 0, recharge: 0, sabotage: 0 },
      4,
    ),
  );
  assert.throws(() =>
    validateAction(
      { repair: 0.5, shield: 0, investigate: 0, recharge: 0, sabotage: 0 },
      4,
    ),
  );
  assert.throws(() =>
    validateAction(
      { repair: 0, shield: 0, investigate: 0, recharge: 0, sabotage: 2 },
      4,
    ),
  );
});
test("seeded events and objectives are reproducible", () => {
  assert.equal(eventFor("same"), eventFor("same"));
  assert.equal(objectiveFor("same", 2), objectiveFor("same", 2));
  const round = game("public-round-seed");
  assert.equal(
    round.players[0].objective,
    objectiveFor("private-objective-seed", 0),
  );
});
test("an absent lobby host hands control to an active crew member", () => {
  const room = createRoom("ABC234", makePlayer(1), 0);
  room.players.push({ ...makePlayer(2), lastSeen: 65_000 });
  assert.equal(transferHostIfAbsent(room, 65_000).hostId, "p2");
  assert.equal(transferHostIfAbsent(room, 30_000).hostId, "p1");
});
test("autopilot protects the reactor but earns no points", () => {
  const room = game();
  const done = resolveRound(room, 80_000);
  assert.equal(
    done.logs[0].revealed.every((r) => r.autopilot && r.points === 0),
    true,
  );
  assert.equal(done.logs[0].repaired, 12);
  assert.equal(done.logs[0].investigationOccurred, false);
  assert.equal(
    done.players.every((p) => p.score === 0),
    true,
  );
});
test("sabotage is capped and exposure resolution is deterministic", () => {
  const room = game("sabotage-seed");
  room.players = room.players.map((p) => ({
    ...p,
    submitted: {
      repair: 0,
      shield: 0,
      investigate: 2,
      recharge: 0,
      sabotage: 1,
    },
  }));
  const a = resolveRound(room, 80_000),
    b = resolveRound(room, 80_000);
  assert.equal(a.logs[0].sabotageDamage, 2);
  assert.equal(a.logs[0].investigationOccurred, true);
  assert.deepEqual(a.logs[0], b.logs[0]);
});
test("exposure wording matches whether the crew investigated", () => {
  assert.equal(
    exposureMessage(false, false),
    "Sabotage detected by station sensors",
  );
  assert.equal(
    exposureMessage(true, false),
    "Your sabotage was detected by station sensors",
  );
  assert.equal(
    exposureMessage(false, true),
    "Sabotage exposed by the crew investigation",
  );
  assert.equal(
    exposureMessage(true, true),
    "Your sabotage was exposed by the crew investigation",
  );
});
test("nicknames normalize visibly and saved seats never silently change identity", () => {
  assert.equal(limitNicknameInput("Charlie Detective"), "Charlie Detectiv");
  assert.equal(limitNicknameInput("   Host   Alpha"), "Host Alpha");
  assert.equal(normalizeNicknameInput("  Charlie   Ops  "), "Charlie Ops");
  assert.equal(savedSeatMatchesName(" host alpha ", "Host Alpha"), true);
  assert.equal(savedSeatMatchesName("Charlie Ops", "Host Alpha"), false);
});
test("recharge and base regeneration respect six-energy cap", () => {
  const room = game();
  room.players[0].submitted = {
    repair: 0,
    shield: 0,
    investigate: 0,
    recharge: 2,
    sabotage: 0,
  };
  const done = resolveRound(room, 80_000);
  assert.equal(done.players[0].battery, 6);
});
test("early reactor failure ends the game and applies failure penalty", () => {
  const room = game("failure");
  room.health = 1;
  room.players[0].submitted = {
    repair: 0,
    shield: 0,
    investigate: 0,
    recharge: 0,
    sabotage: 1,
  };
  room.players[1].submitted = {
    repair: 0,
    shield: 0,
    investigate: 2,
    recharge: 0,
    sabotage: 0,
  };
  room.players[2].submitted = {
    repair: 0,
    shield: 0,
    investigate: 2,
    recharge: 0,
    sabotage: 0,
  };
  const done = resolveRound(room, 80_000);
  assert.equal(done.phase, "reveal");
  assert.equal(done.gameEnded, true);
  assert.equal(done.health, 0);
  assert.ok(done.players[0].score <= -10);
  assert.ok(done.winnerIds.length > 0);
  const breakdown = scoreBreakdownFor(done, done.players[0]);
  assert.equal(breakdown.sabotageReward, 0);
  assert.equal(breakdown.sabotageFailurePenalty, -6);
  assert.equal(
    breakdown.roundPoints +
      breakdown.survivalBonus +
      breakdown.sabotageReward +
      breakdown.sabotageFailurePenalty +
      breakdown.objectiveBonus,
    breakdown.total,
  );
});
test("pending sabotage rewards pay only after survival and disappear on failure", () => {
  let failedRoom = game("pending-round");
  failedRoom.players[0].objective = "engineer";
  failedRoom.players[0].submitted = {
    repair: 0,
    shield: 0,
    investigate: 0,
    recharge: 0,
    sabotage: 1,
  };
  failedRoom.players[1].submitted = {
    repair: 2,
    shield: 0,
    investigate: 0,
    recharge: 0,
    sabotage: 0,
  };
  failedRoom.players[2].submitted = { ...failedRoom.players[1].submitted };
  failedRoom = resolveRound(failedRoom, 80_000);
  assert.ok(failedRoom.logs[0].revealed[0].points <= 0);
  failedRoom = beginNextRound(
    failedRoom,
    "failure-round",
    "failure-commit",
    92_000,
  );
  failedRoom.health = 1;
  failedRoom.players = failedRoom.players.map((p) => ({
    ...p,
    submitted: { ...EMPTY_ACTION },
  }));
  failedRoom = resolveRound(failedRoom, 172_000);
  const failedBreakdown = scoreBreakdownFor(
    failedRoom,
    failedRoom.players[0],
  );
  assert.equal(failedBreakdown.sabotageReward, 0);
  assert.equal(failedBreakdown.sabotageFailurePenalty, -6);
  assert.equal(
    failedBreakdown.roundPoints +
      failedBreakdown.survivalBonus +
      failedBreakdown.sabotageReward +
      failedBreakdown.sabotageFailurePenalty +
      failedBreakdown.objectiveBonus,
    failedBreakdown.total,
  );

  let survivedRoom = game("survival-round");
  survivedRoom.round = MAX_ROUNDS;
  survivedRoom.players[0].objective = "engineer";
  survivedRoom.players[0].submitted = {
    repair: 0,
    shield: 0,
    investigate: 0,
    recharge: 0,
    sabotage: 1,
  };
  survivedRoom.players[1].submitted = {
    repair: 3,
    shield: 0,
    investigate: 0,
    recharge: 0,
    sabotage: 0,
  };
  survivedRoom.players[2].submitted = { ...survivedRoom.players[1].submitted };
  survivedRoom = resolveRound(survivedRoom, 80_000);
  const survivedBreakdown = scoreBreakdownFor(
    survivedRoom,
    survivedRoom.players[0],
  );
  assert.equal(survivedBreakdown.sabotageReward, 3);
  assert.equal(survivedBreakdown.sabotageFailurePenalty, 0);
  assert.equal(survivedBreakdown.survivalBonus, 3);
  assert.equal(
    survivedBreakdown.roundPoints +
      survivedBreakdown.survivalBonus +
      survivedBreakdown.sabotageReward +
      survivedBreakdown.sabotageFailurePenalty +
      survivedBreakdown.objectiveBonus,
    survivedBreakdown.total,
  );
});
test("seven rounds finish with survival awards and winners", () => {
  let room = game("one");
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    room.players = room.players.map((p) => ({
      ...p,
      submitted: {
        repair: 3,
        shield: 1,
        investigate: 0,
        recharge: 0,
        sabotage: 0,
      },
    }));
    room = resolveRound(room, round * 100_000);
    if (round < MAX_ROUNDS)
      room = beginNextRound(
        room,
        `seed-${round + 1}`,
        `commit-${round + 1}`,
        round * 100_000 + 12_000,
      );
  }
  assert.equal(room.phase, "reveal");
  assert.equal(room.gameEnded, true);
  room = finishGame(room);
  assert.equal(room.phase, "finished");
  assert.equal(room.logs.length, 7);
  assert.ok(room.health > 0);
  assert.ok(room.winnerIds.length >= 1);
  assert.ok(room.players.every((p) => p.score >= 3));
});

test("locked active plans shorten the timer without waiting for absent crew", () => {
  const room = game();
  room.players[0].lastSeen = 50_000;
  room.players[0].submitted = {
    repair: 1,
    shield: 0,
    investigate: 0,
    recharge: 0,
    sabotage: 0,
  };
  const shortened = shortenDeadlineWhenLocked(room, 50_000);
  assert.equal(shortened.deadline, 55_000);
  assert.equal(room.deadline, 80_000, "input remains immutable");
});

test("an unlocked reconnecting player prevents early resolution", () => {
  const room = game();
  room.players[0].submitted = {
    repair: 1,
    shield: 0,
    investigate: 0,
    recharge: 0,
    sabotage: 0,
  };
  room.players[1].submitted = { ...room.players[0].submitted };
  const held = shortenDeadlineWhenLocked(room, 35_000);
  assert.equal(held.deadline, 80_000);
  room.players[2].submitted = { ...room.players[0].submitted };
  room.players[2].lastSeen = 35_000;
  const returnedAndLocked = shortenDeadlineWhenLocked(room, 35_000);
  assert.equal(returnedAndLocked.deadline, 40_000);
});

test("round logs reveal only the viewer's plan and exposed saboteur identity", () => {
  const room = game("privacy-seed");
  const resolved = resolveRound(room, 80_000);
  resolved.logs[0].revealed[0].exposed = false;
  resolved.logs[0].revealed[1].exposed = true;
  resolved.logs[0].revealed[2].exposed = false;
  const visible = visibleLogForPlayer(resolved.logs[0], "p1", false);
  assert.deepEqual(visible.revealed.map((p) => p.id), ["p1", "p2"]);
  assert.ok("action" in visible.revealed[0]);
  assert.equal("action" in visible.revealed[1], false);
  assert.equal(visible.revealed[1].exposed, true);
  const final = visibleLogForPlayer(resolved.logs[0], "p1", true);
  assert.equal(final.revealed.length, 3);
  assert.ok(final.revealed.every((p) => "action" in p));
});

test("final scores have an auditable breakdown and rematch preserves the crew", () => {
  let room = game("rematch-seed");
  room.round = MAX_ROUNDS;
  room = finishGame(resolveRound(room, 80_000));
  const breakdown = scoreBreakdownFor(room, room.players[0]);
  assert.equal(breakdown.total, room.players[0].score);
  assert.equal(
    breakdown.roundPoints +
      breakdown.survivalBonus +
      breakdown.sabotageReward +
      breakdown.sabotageFailurePenalty +
      breakdown.objectiveBonus,
    breakdown.total,
  );
  const ids = room.players.map((p) => [p.id, p.tokenHash]);
  const rematch = resetForRematch(room, 90_000);
  assert.equal(rematch.phase, "lobby");
  assert.equal(rematch.round, 0);
  assert.equal(rematch.logs.length, 0);
  assert.deepEqual(rematch.players.map((p) => [p.id, p.tokenHash]), ids);
  assert.ok(rematch.players.every((p) => !p.ready && p.score === 0));
});

import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const base = process.env.GAME_URL ?? "http://127.0.0.1:8787";
async function request(path, body, token) {
  const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: {
    ...(body ? { "content-type": "application/json" } : {}), ...(token ? { "x-player-token": token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(data)}`);
  return data;
}
const overlongName = await fetch(base + "/api/rooms", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Charlie Detective" }),
});
assert.equal(overlongName.status, 400);
const normalizedName = await request("/api/rooms", { name: "  Trim   Test  " });
assert.equal(normalizedName.room.players[0].name, "Trim Test");
const host = await request("/api/rooms", { name: "Ada" });
const path = `/api/rooms/${host.code}`;
const bob = await request(path, { type: "join", name: "Bex" });
const cy = await request(path, { type: "join", name: "Cy" });
assert.equal(host.room.players.length, 1);
assert.equal(cy.room.players.length, 3);
const clients = [host, bob, cy];
for (const client of clients) await request(path, { type: "ready" }, client.token);
await delay(350);
const started = await request(path, { type: "start" }, host.token);
assert.equal(started.phase, "decision");
assert.equal(started.round, 1);
assert.ok(started.commit && !started.seed);
await delay(350);
await request(path, { type: "submit", action: { repair: 0, shield: 0, investigate: 2, recharge: 0, sabotage: 1 } }, host.token);
const bobView = await request(path, null, bob.token);
assert.equal(bobView.players.find(p => p.id === host.room.me.id).submitted, true);
assert.equal("score" in bobView.players.find(p => p.id === host.room.me.id), false);
assert.equal("score" in bobView.players.find(p => p.id === bob.room.me.id), true);
assert.equal(bobView.players.some(p => "battery" in p), false);
assert.equal(JSON.stringify(bobView).includes('"sabotage":1'), false);
assert.equal(JSON.stringify(bobView).includes(host.token), false);
const ownView = await request(path, null, host.token);
assert.equal(ownView.me.action.sabotage, 1);
const reject = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-player-token": bob.token }, body: JSON.stringify({ type: "submit", action: { repair: 9, shield: 0, investigate: 0, recharge: 0, sabotage: 0 } }) });
assert.equal(reject.status, 400);
console.log("Three clients joined, readied, started, and secret choices remained private.");
await request(path, { type: "submit", action: { repair: 2, shield: 0, investigate: 0, recharge: 0, sabotage: 0 } }, bob.token);
await request(path, { type: "submit", action: { repair: 0, shield: 2, investigate: 0, recharge: 0, sabotage: 0 } }, cy.token);
await delay(5_500);
const resolved = await request(path, null, cy.token);
assert.equal(resolved.logs.length, 1);
const hostReveal = resolved.logs[0].revealed.find(p => p.id === host.room.me.id);
assert.equal(hostReveal ? "action" in hostReveal : false, false);
assert.equal(resolved.logs[0].revealed.find(p => p.id === cy.room.me.id).action.shield, 2);
assert.equal("score" in resolved.players.find(p => p.id === host.room.me.id), false);
assert.equal(resolved.players.some(p => "battery" in p), false);
assert.equal(resolved.players.some(p => "pendingSabotageReward" in p), false);
assert.equal(resolved.me.pendingSabotageReward, 0);
const hostResolved = await request(path, null, host.token);
assert.equal(hostResolved.me.pendingSabotageReward, 3);
assert.equal(hostResolved.players.some(p => "pendingSabotageReward" in p), false);
assert.ok(resolved.logs[0].seed);
assert.equal(resolved.phase, "reveal");
console.log("All active plans triggered early resolution; only the viewer's plan and any exposed saboteur identity were visible.");

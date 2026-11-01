import assert from "node:assert/strict";

const base = process.env.GAME_URL ?? "http://127.0.0.1:8787";
async function post(path, body, token) {
  const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-player-token": token } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const created = await post("/api/rooms", { name: "Host" });
assert.equal(created.status, 200);
const { code, token } = created.data;
const path = `/api/rooms/${code}`;
const joins = await Promise.all(Array.from({ length: 7 }, (_, i) => post(path, { type: "join", name: `Crew ${i}` })));
assert.deepEqual(joins.map(j => j.status), Array(7).fill(200));
const viewResponse = await fetch(base + path, { headers: { "x-player-token": token } });
const view = await viewResponse.json();
assert.equal(view.players.length, 8);
const unauthorized = await fetch(base + path, { headers: { "x-player-token": "0".repeat(64) } });
assert.equal(unauthorized.status, 401);
const overfull = await post(path, { type: "join", name: "Extra" });
assert.equal(overfull.status, 409);
console.log("Seven concurrent joins preserved all eight seats; invalid pass and ninth join rejected.");

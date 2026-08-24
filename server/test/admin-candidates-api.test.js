// README roadmap #7A, Phase J: HTTP-level integration tests for the
// admin-only candidate API (server/routes/adminCandidates.js). Same
// real-server-as-a-subprocess approach as every other *.test.js file here
// -- authorization logic lives in the route handlers, not the DB layer.
//
// Candidate rows are seeded via a direct SQLite connection to the same
// throwaway DB file (matching the scratch-tested pattern used elsewhere
// this session for schema/migration verification), rather than through
// POST /discover -- there is deliberately no way to create a candidate
// through the public API surface (candidates only ever come from the
// discovery pipeline), and the pipeline itself already has dedicated,
// network-free coverage in candidate-pipeline.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

const PORT = 4099;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, `admin-candidates-test-${Date.now()}.db`);

let serverProcess;
let seededCandidateId;

test.before(async () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  }
  serverProcess = spawn("node", ["index.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), DB_PATH, DB_DRIVER: "sqlite" },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server did not start in time")), 15000);
    const tryHealth = async () => {
      try {
        const res = await fetch(`${BASE}/api/health`);
        if (res.ok) {
          clearTimeout(timeout);
          resolve();
          return;
        }
      } catch {}
      setTimeout(tryHealth, 300);
    };
    tryHealth();
  });

  // Seed two candidates directly -- one plain, one with sources/events --
  // via a second connection to the same file. WAL mode (already enabled
  // by db-sqlite.js on boot) supports this kind of single-writer access
  // safely; the connection is opened, used, and closed immediately, with
  // no requests in flight against the server yet.
  const seedDb = new Database(DB_PATH);
  const info = seedDb
    .prepare(
      `INSERT INTO candidates (category_code, display_name, normalized_name, country, city, status)
       VALUES ('Electrician','Seeded Sparky','seeded sparky','Algeria','Setif','discovered')`
    )
    .run();
  seedDb
    .prepare("INSERT INTO candidate_sources (candidate_id, provider, external_id, license) VALUES (?, 'osm', 'node/seed-1', 'ODbL')")
    .run(info.lastInsertRowid);
  seedDb
    .prepare("INSERT INTO candidate_events (candidate_id, event_type, to_status) VALUES (?, 'discovered', 'discovered')")
    .run(info.lastInsertRowid);
  seededCandidateId = info.lastInsertRowid;
  seedDb.close();
});

test.after(async () => {
  await new Promise((resolve) => {
    serverProcess.once("exit", resolve);
    serverProcess.kill();
  });
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  }
});

async function login(email, password = "password123") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).token;
}

async function api(path_, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path_}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// --- Authorization ---

test("auth: unauthenticated requests are rejected on every route", async () => {
  assert.equal((await api("/api/admin/candidates")).status, 401);
  assert.equal((await api(`/api/admin/candidates/${seededCandidateId}`)).status, 401);
  assert.equal((await api(`/api/admin/candidates/${seededCandidateId}/status`, { method: "PUT", body: { status: "qualified" } })).status, 401);
  assert.equal((await api("/api/admin/candidates/discover", { method: "POST", body: { country: "Algeria", category: "Plumber" } })).status, 401);
});

test("auth: a client cannot access candidate routes", async () => {
  const token = await login("client1@example.com");
  assert.equal((await api("/api/admin/candidates", { token })).status, 403);
});

test("auth: an artisan cannot access candidate routes", async () => {
  const token = await login("artisan1@example.com");
  assert.equal((await api("/api/admin/candidates", { token })).status, 403);
});

// --- Listing / detail (public non-exposure is covered separately in the
// existing artisans/services regression tests, which never select from
// candidates at all) ---

test("list: an admin can list candidates and filter by status/category", async () => {
  const token = await login("admin@nearhandsat.com");
  const all = await api("/api/admin/candidates", { token });
  assert.equal(all.status, 200);
  assert.ok(all.data.total >= 1);
  assert.ok(all.data.results.some((c) => c.id === seededCandidateId));

  const filtered = await api("/api/admin/candidates?status=discovered&category=Electrician", { token });
  assert.equal(filtered.status, 200);
  assert.ok(filtered.data.results.every((c) => c.status === "discovered" && c.category_code === "Electrician"));

  const noMatch = await api("/api/admin/candidates?category=Painter", { token });
  assert.equal(noMatch.data.results.length, 0);
});

test("list: an invalid status filter is rejected", async () => {
  const token = await login("admin@nearhandsat.com");
  const { status } = await api("/api/admin/candidates?status=not-a-real-status", { token });
  assert.equal(status, 400);
});

test("detail: an admin can view a candidate with its full provenance and event history", async () => {
  const token = await login("admin@nearhandsat.com");
  const { status, data } = await api(`/api/admin/candidates/${seededCandidateId}`, { token });
  assert.equal(status, 200);
  assert.equal(data.display_name, "Seeded Sparky");
  assert.equal(data.sources.length, 1);
  assert.equal(data.sources[0].provider, "osm");
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].event_type, "discovered");
});

test("detail: a nonexistent candidate returns 404", async () => {
  const token = await login("admin@nearhandsat.com");
  const { status } = await api("/api/admin/candidates/999999", { token });
  assert.equal(status, 404);
});

// --- Status transition (the human-review action) ---

test("status: an admin can transition a candidate's status, and the transition is logged as an event", async () => {
  const token = await login("admin@nearhandsat.com");
  const { status, data } = await api(`/api/admin/candidates/${seededCandidateId}/status`, {
    method: "PUT",
    token,
    body: { status: "qualified" },
  });
  assert.equal(status, 200);
  assert.equal(data.status, "qualified");

  const detail = await api(`/api/admin/candidates/${seededCandidateId}`, { token });
  assert.equal(detail.data.status, "qualified");
  const statusEvents = detail.data.events.filter((e) => e.event_type === "status_changed");
  assert.equal(statusEvents.length, 1);
  assert.equal(statusEvents[0].from_status, "discovered");
  assert.equal(statusEvents[0].to_status, "qualified");
});

test("status: an invalid status value is rejected", async () => {
  const token = await login("admin@nearhandsat.com");
  const { status } = await api(`/api/admin/candidates/${seededCandidateId}/status`, {
    method: "PUT",
    token,
    body: { status: "contacted" }, // explicitly NOT a valid #7A status -- outreach is out of scope
  });
  assert.equal(status, 400);
});

// --- Manual discovery trigger ---

test("discover: missing country or category is rejected before any provider is invoked", async () => {
  const token = await login("admin@nearhandsat.com");
  assert.equal((await api("/api/admin/candidates/discover", { method: "POST", token, body: { category: "Plumber" } })).status, 400);
  assert.equal((await api("/api/admin/candidates/discover", { method: "POST", token, body: { country: "Algeria" } })).status, 400);
  assert.equal(
    (await api("/api/admin/candidates/discover", { method: "POST", token, body: { country: "Algeria", category: "NotARealTrade" } })).status,
    400
  );
});

test("discover: a category with no OSM tag mapping runs the full pipeline with zero results, with no network dependency", async () => {
  const token = await login("admin@nearhandsat.com");
  const { status, data } = await api("/api/admin/candidates/discover", {
    method: "POST",
    token,
    body: { country: "Algeria", category: "Cleaner", limit: 5 },
  });
  assert.equal(status, 200);
  assert.equal(data.discovered, 0);
  assert.equal(data.newCandidates, 0);
});

// --- Regression: candidates must never leak through existing public
// endpoints, and every prior roadmap phase must keep working ---

test("regression: public artisan search still works and never exposes candidate data", async () => {
  const { status, data } = await api("/api/artisans");
  assert.equal(status, 200);
  assert.ok(data.total > 0);
  assert.ok(!JSON.stringify(data).includes("Seeded Sparky"));
});

test("regression: login still works", async () => {
  const token = await login("admin@nearhandsat.com");
  assert.ok(token);
});

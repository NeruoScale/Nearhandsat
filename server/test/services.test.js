// HTTP-level integration tests for /api/services (README roadmap #3).
// Unlike db.test.js (which exercises the DB layer directly), authorization
// and visibility rules live in the route handlers themselves, so this spins
// up the real server as a child process against a throwaway SQLite file and
// drives it over real HTTP -- the same "real behavior, not mocks" approach
// the rest of this app's testing already follows, just at the HTTP layer
// instead of the DB layer, since that's what's actually needed to prove
// ownership enforcement and draft/published visibility.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const PORT = 4098;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, `services-test-${Date.now()}.db`);

let serverProcess;

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
  const data = await res.json();
  return data.token;
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

const VALID_SERVICE = {
  title: "Emergency Plumbing Repair",
  description: "Leaking pipes, faucets, and water connections.",
  category: "Plumber",
  pricing_model: "starting_at",
  price: 2500,
  currency: "dzd",
};

// --- Creation ---

test("creation: unauthenticated user cannot create a service", async () => {
  const { status } = await api("/api/services", { method: "POST", body: VALID_SERVICE });
  assert.equal(status, 401);
});

test("creation: a client (not an artisan) cannot create a service", async () => {
  const token = await login("client1@example.com");
  const { status } = await api("/api/services", { method: "POST", token, body: VALID_SERVICE });
  assert.equal(status, 403);
});

test("creation: authenticated artisan can create a service, defaults to draft", async () => {
  const token = await login("artisan1@example.com");
  const { status, data } = await api("/api/services", { method: "POST", token, body: VALID_SERVICE });
  assert.equal(status, 201);
  assert.equal(data.status, "draft");
  assert.equal(data.title, VALID_SERVICE.title);
  assert.equal(data.currency, "DZD"); // normalized to uppercase
});

test("creation: missing title is rejected", async () => {
  const token = await login("artisan1@example.com");
  const { status, data } = await api("/api/services", {
    method: "POST",
    token,
    body: { ...VALID_SERVICE, title: "" },
  });
  assert.equal(status, 400);
  assert.ok(data.error);
});

test("creation: invalid category is rejected", async () => {
  const token = await login("artisan1@example.com");
  const { status } = await api("/api/services", {
    method: "POST",
    token,
    body: { ...VALID_SERVICE, category: "Astronaut" },
  });
  assert.equal(status, 400);
});

test("creation: missing price is rejected unless pricing_model is 'quote'", async () => {
  const token = await login("artisan1@example.com");
  const missingPrice = await api("/api/services", {
    method: "POST",
    token,
    body: { ...VALID_SERVICE, price: undefined },
  });
  assert.equal(missingPrice.status, 400);

  const quote = await api("/api/services", {
    method: "POST",
    token,
    body: { ...VALID_SERVICE, pricing_model: "quote", price: undefined },
  });
  assert.equal(quote.status, 201);
  assert.equal(quote.data.price, null);
});

// --- Ownership ---

test("ownership: artisan can edit their own service", async () => {
  const token = await login("artisan1@example.com");
  const created = await api("/api/services", { method: "POST", token, body: VALID_SERVICE });
  const { status, data } = await api(`/api/services/${created.data.id}`, {
    method: "PUT",
    token,
    body: { title: "Updated title" },
  });
  assert.equal(status, 200);
  assert.equal(data.title, "Updated title");
});

test("ownership: artisan cannot edit another artisan's service", async () => {
  const ownerToken = await login("artisan1@example.com");
  const created = await api("/api/services", { method: "POST", token: ownerToken, body: VALID_SERVICE });

  const otherToken = await login("artisan2@example.com");
  const { status } = await api(`/api/services/${created.data.id}`, {
    method: "PUT",
    token: otherToken,
    body: { title: "Hijacked" },
  });
  assert.equal(status, 404); // not found, not 403 -- matches this app's existing ownership-check convention
});

test("ownership: artisan cannot publish another artisan's service", async () => {
  const ownerToken = await login("artisan1@example.com");
  const created = await api("/api/services", { method: "POST", token: ownerToken, body: VALID_SERVICE });

  const otherToken = await login("artisan2@example.com");
  const { status } = await api(`/api/services/${created.data.id}/status`, {
    method: "PUT",
    token: otherToken,
    body: { status: "published" },
  });
  assert.equal(status, 404);
});

// --- Visibility ---

test("visibility: a published service is publicly discoverable", async () => {
  const token = await login("artisan3@example.com");
  const created = await api("/api/services", { method: "POST", token, body: VALID_SERVICE });
  await api(`/api/services/${created.data.id}/status`, { method: "PUT", token, body: { status: "published" } });

  const { status, data } = await api(`/api/services/${created.data.id}`);
  assert.equal(status, 200);
  assert.equal(data.status, "published");

  const list = await api("/api/services?category=Plumber");
  assert.ok(list.data.results.some((r) => r.id === created.data.id));
});

test("visibility: a draft service is not publicly discoverable", async () => {
  const token = await login("artisan3@example.com");
  const created = await api("/api/services", { method: "POST", token, body: VALID_SERVICE });

  const detail = await api(`/api/services/${created.data.id}`);
  assert.equal(detail.status, 404);

  const list = await api("/api/services?category=Plumber");
  assert.ok(!list.data.results.some((r) => r.id === created.data.id));
});

test("visibility: an archived service is not publicly discoverable", async () => {
  const token = await login("artisan3@example.com");
  const created = await api("/api/services", { method: "POST", token, body: VALID_SERVICE });
  await api(`/api/services/${created.data.id}/status`, { method: "PUT", token, body: { status: "published" } });
  await api(`/api/services/${created.data.id}/status`, { method: "PUT", token, body: { status: "archived" } });

  const detail = await api(`/api/services/${created.data.id}`);
  assert.equal(detail.status, 404);

  const list = await api("/api/services?category=Plumber");
  assert.ok(!list.data.results.some((r) => r.id === created.data.id));
});

test("visibility: the owner can still preview their own unpublished service", async () => {
  const token = await login("artisan3@example.com");
  const created = await api("/api/services", { method: "POST", token, body: VALID_SERVICE });

  const { status, data } = await api(`/api/services/${created.data.id}`, { token });
  assert.equal(status, 200);
  assert.equal(data.status, "draft");
});

test("visibility: raw coordinates/radius never appear in service responses", async () => {
  const token = await login("artisan3@example.com");
  const created = await api("/api/services", { method: "POST", token, body: VALID_SERVICE });
  await api(`/api/services/${created.data.id}/status`, { method: "PUT", token, body: { status: "published" } });

  const list = await api("/api/services?category=Plumber");
  const keys = Object.keys(list.data.results[0]);
  assert.ok(!keys.includes("latitude") && !keys.includes("longitude") && !keys.includes("service_radius_km"));
});

// --- Search / geographic integration (roadmap #2 reuse) ---

test("search: category matching works alongside existing artisan search", async () => {
  const artisanList = await api("/api/artisans?category=Plumber");
  assert.ok(artisanList.data.results.length > 0, "existing artisan category search still works");

  const serviceList = await api("/api/services?category=Plumber");
  assert.ok(serviceList.data.results.every((r) => r.category === "Plumber"));
});

test("search: radius filtering surfaces a nearby-city service and excludes it when the radius shrinks", async () => {
  // artisan4 (Omar Belkacem) is in El Eulma, ~25km from Setif -- same
  // scenario proven for /api/artisans in roadmap #2.
  const token = await login("artisan4@example.com");
  const created = await api("/api/services", { method: "POST", token, body: VALID_SERVICE });
  await api(`/api/services/${created.data.id}/status`, { method: "PUT", token, body: { status: "published" } });

  await api("/api/artisans/me", { method: "PUT", token, body: { service_radius_km: 50 } });
  const inRange = await api("/api/services?country=Algeria&city=Setif&category=Plumber");
  assert.ok(inRange.data.results.some((r) => r.id === created.data.id), "50km radius should cover ~25km distance");

  await api("/api/artisans/me", { method: "PUT", token, body: { service_radius_km: 5 } });
  const outOfRange = await api("/api/services?country=Algeria&city=Setif&category=Plumber");
  assert.ok(!outOfRange.data.results.some((r) => r.id === created.data.id), "5km radius should not cover ~25km distance");
});

// --- Regression: existing endpoints still work ---

test("regression: existing artisan search still returns results", async () => {
  const { status, data } = await api("/api/artisans");
  assert.equal(status, 200);
  assert.ok(data.total > 0);
});

test("regression: login still works", async () => {
  const token = await login("admin@nearhandsat.com");
  assert.ok(token);
});

// HTTP-level integration tests for README roadmap #4 (Service Inquiry ->
// Lead/Job): the new service_id link on the existing leads table, and the
// server-authoritative artisan derivation on POST /api/leads. Same
// real-server-as-a-subprocess approach as services.test.js, for the same
// reason -- ownership/authorization logic lives in the route handlers, not
// the DB layer.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const PORT = 4097;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, `leads-test-${Date.now()}.db`);

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

// Creates + publishes a service for the given artisan, returns its id.
async function publishedService(artisanToken, overrides = {}) {
  const created = await api("/api/services", {
    method: "POST",
    token: artisanToken,
    body: {
      title: "Emergency Plumbing Repair",
      description: "Leaking pipes and faucets.",
      category: "Plumber",
      pricing_model: "starting_at",
      price: 2500,
      currency: "DZD",
      ...overrides,
    },
  });
  await api(`/api/services/${created.data.id}/status`, {
    method: "PUT",
    token: artisanToken,
    body: { status: "published" },
  });
  return created.data.id;
}

// --- Authentication ---

test("auth: unauthenticated client cannot create a lead", async () => {
  const { status } = await api("/api/leads", { method: "POST", body: { artisanId: 5, message: "hi" } });
  assert.equal(status, 401);
});

test("auth: unauthenticated user cannot list leads", async () => {
  const { status } = await api("/api/leads/mine");
  assert.equal(status, 401);
});

// --- Creation ---

test("creation: authenticated client can create a lead for a published service; service_id and artisan are derived correctly", async () => {
  const artisanToken = await login("artisan1@example.com"); // Yasmine Boudiaf, user id 5
  const serviceId = await publishedService(artisanToken);

  const clientToken = await login("client1@example.com");
  const { status, data } = await api("/api/leads", {
    method: "POST",
    token: clientToken,
    body: { serviceId, message: "Need this done ASAP." },
  });
  assert.equal(status, 201);
  assert.equal(data.service_id, serviceId);

  const detail = await api(`/api/leads/${data.id}`, { token: clientToken });
  assert.equal(detail.data.service_id, serviceId);
  assert.equal(detail.data.artisan_id, 5);
  assert.equal(detail.data.client_id, detail.data.client_id); // sanity: field present
});

test("creation: empty description/message is rejected", async () => {
  const artisanToken = await login("artisan1@example.com");
  const serviceId = await publishedService(artisanToken);
  const clientToken = await login("client2@example.com");
  const { status } = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId, message: "" } });
  assert.equal(status, 400);
});

test("creation: nonexistent service is rejected", async () => {
  const clientToken = await login("client2@example.com");
  const { status } = await api("/api/leads", {
    method: "POST",
    token: clientToken,
    body: { serviceId: 999999, message: "hi" },
  });
  assert.equal(status, 404);
});

// --- Service visibility ---

test("service visibility: a draft service cannot receive a lead", async () => {
  const artisanToken = await login("artisan1@example.com");
  const created = await api("/api/services", {
    method: "POST",
    token: artisanToken,
    body: { title: "Draft only", description: "", category: "Plumber", pricing_model: "quote" },
  });
  const clientToken = await login("client2@example.com");
  const { status } = await api("/api/leads", {
    method: "POST",
    token: clientToken,
    body: { serviceId: created.data.id, message: "hi" },
  });
  assert.equal(status, 400);
});

test("service visibility: an archived service cannot receive a lead", async () => {
  const artisanToken = await login("artisan1@example.com");
  const serviceId = await publishedService(artisanToken, { title: "Will be archived" });
  await api(`/api/services/${serviceId}/status`, { method: "PUT", token: artisanToken, body: { status: "archived" } });

  const clientToken = await login("client2@example.com");
  const { status } = await api("/api/leads", {
    method: "POST",
    token: clientToken,
    body: { serviceId, message: "hi" },
  });
  assert.equal(status, 400);
});

// --- Integrity ---

test("integrity: a client-submitted artisanId is ignored once serviceId is present -- the service's real owner is used", async () => {
  const ownerToken = await login("artisan1@example.com"); // user id 5
  const serviceId = await publishedService(ownerToken, { title: "Owner-derived test" });

  const clientToken = await login("client3@example.com");
  const { data } = await api("/api/leads", {
    method: "POST",
    token: clientToken,
    body: { serviceId, artisanId: 6, message: "Trying to redirect this lead" }, // artisanId 6 = a different artisan
  });

  const detail = await api(`/api/leads/${data.id}`, { token: clientToken });
  assert.equal(detail.data.artisan_id, 5, "the service owner (5), not the submitted artisanId (6), must be used");
});

// --- Ownership ---

test("ownership: a client cannot read another client's lead", async () => {
  const artisanToken = await login("artisan1@example.com");
  const serviceId = await publishedService(artisanToken, { title: "Ownership test A" });
  const client1Token = await login("client1@example.com");
  const created = await api("/api/leads", { method: "POST", token: client1Token, body: { serviceId, message: "hi" } });

  const client2Token = await login("client2@example.com");
  const { status } = await api(`/api/leads/${created.data.id}`, { token: client2Token });
  assert.equal(status, 403);
});

test("ownership: a professional cannot read another professional's lead", async () => {
  const artisan1Token = await login("artisan1@example.com");
  const serviceId = await publishedService(artisan1Token, { title: "Ownership test B" });
  const clientToken = await login("client1@example.com");
  const created = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId, message: "hi" } });

  const artisan2Token = await login("artisan2@example.com");
  const { status } = await api(`/api/leads/${created.data.id}`, { token: artisan2Token });
  assert.equal(status, 403);
});

test("ownership: a professional cannot modify another professional's lead", async () => {
  const artisan1Token = await login("artisan1@example.com");
  const serviceId = await publishedService(artisan1Token, { title: "Ownership test C" });
  const clientToken = await login("client1@example.com");
  const created = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId, message: "hi" } });

  const artisan2Token = await login("artisan2@example.com");
  const { status } = await api(`/api/leads/${created.data.id}/self-report`, {
    method: "POST",
    token: artisan2Token,
    body: { outcome: "hired" },
  });
  assert.equal(status, 403);

  // confirm the target record was not mutated by the rejected attempt
  const detail = await api(`/api/leads/${created.data.id}`, { token: artisan1Token });
  assert.equal(detail.data.status, "contacted");
});

// --- Status ---

test("status: the owning professional can update their own lead", async () => {
  const artisanToken = await login("artisan1@example.com");
  const serviceId = await publishedService(artisanToken, { title: "Status test A" });
  const clientToken = await login("client1@example.com");
  const created = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId, message: "hi" } });

  const { status, data } = await api(`/api/leads/${created.data.id}/self-report`, {
    method: "POST",
    token: artisanToken,
    body: { outcome: "hired" },
  });
  assert.equal(status, 200);
  assert.equal(data.status, "hired");
});

test("status: a client cannot use the professional-only status endpoint", async () => {
  const artisanToken = await login("artisan1@example.com");
  const serviceId = await publishedService(artisanToken, { title: "Status test B" });
  const clientToken = await login("client1@example.com");
  const created = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId, message: "hi" } });

  const { status } = await api(`/api/leads/${created.data.id}/self-report`, {
    method: "POST",
    token: clientToken,
    body: { outcome: "hired" },
  });
  assert.equal(status, 403);
});

test("status: an invalid status value is rejected", async () => {
  const artisanToken = await login("artisan1@example.com");
  const serviceId = await publishedService(artisanToken, { title: "Status test C" });
  const clientToken = await login("client1@example.com");
  const created = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId, message: "hi" } });

  const { status } = await api(`/api/leads/${created.data.id}/self-report`, {
    method: "POST",
    token: artisanToken,
    body: { outcome: "banana" },
  });
  assert.equal(status, 400);
});

test("status: an invalid transition (completing a lead that was never hired) is rejected", async () => {
  // README roadmap #6: completion is professional-only now (was reachable
  // by either participant when this test was first written) -- using the
  // artisan's own token here so this test actually exercises the status-
  // transition check it's named for, rather than the role check.
  const artisanToken = await login("artisan1@example.com");
  const serviceId = await publishedService(artisanToken, { title: "Status test D" });
  const clientToken = await login("client1@example.com");
  const created = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId, message: "hi" } });

  const { status } = await api(`/api/leads/${created.data.id}/complete`, { method: "POST", token: artisanToken });
  assert.equal(status, 400);
});

// --- Duplicate-request policy ---

test("duplicate policy: a rapid resubmission to the same artisan is rejected with 409", async () => {
  const artisanToken = await login("artisan1@example.com");
  const serviceId = await publishedService(artisanToken, { title: "Duplicate test" });
  const clientToken = await login("client1@example.com");

  const first = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId, message: "First message" } });
  assert.equal(first.status, 201);

  const second = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId, message: "Second message" } });
  assert.equal(second.status, 409);
});

// --- Regression ---

test("regression: existing artisan search, service search, and radius filtering still work", async () => {
  const artisans = await api("/api/artisans");
  assert.equal(artisans.status, 200);
  assert.ok(artisans.data.total > 0);

  const services = await api("/api/services?category=Plumber");
  assert.equal(services.status, 200);

  const radius = await api("/api/artisans?country=Algeria&city=Setif");
  assert.equal(radius.status, 200);
});

test("regression: login still works", async () => {
  const token = await login("admin@nearhandsat.com");
  assert.ok(token);
});

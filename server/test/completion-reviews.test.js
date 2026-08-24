// HTTP integration tests for README roadmap #6 (Job Completion + Reviews).
// Same real-server-as-a-subprocess approach as the other roadmap #4/#5
// test files -- completion authorization and review eligibility live in
// the route handlers, not the DB layer.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const PORT = 4093;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, `completion-test-${Date.now()}.db`);

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
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// Creates a fresh service + lead for the given artisan/client pair. Each
// test uses a distinct client so the roadmap #4 duplicate-request guard
// (client+artisan+service, 60s window) never collides across tests.
let clientCounter = 1;
async function freshLead(artisanEmail, opts = {}) {
  const artisanToken = await login(artisanEmail);
  const svc = await api("/api/services", {
    method: "POST",
    token: artisanToken,
    body: { title: "Roadmap6 test service", description: "", category: "Electrician", pricing_model: "quote" },
  });
  await api(`/api/services/${svc.data.id}/status`, { method: "PUT", token: artisanToken, body: { status: "published" } });
  const clientEmail = opts.clientEmail || `client${(clientCounter % 3) + 1}@example.com`;
  clientCounter++;
  const clientToken = await login(clientEmail);
  const lead = await api("/api/leads", { method: "POST", token: clientToken, body: { serviceId: svc.data.id, message: "hi" } });
  return { leadId: lead.data.id, artisanToken, clientToken, clientEmail };
}

async function hiredLead(artisanEmail, opts) {
  const ctx = await freshLead(artisanEmail, opts);
  await api(`/api/leads/${ctx.leadId}/hire`, { method: "POST", token: ctx.clientToken });
  return ctx;
}

async function completedLead(artisanEmail, opts) {
  const ctx = await hiredLead(artisanEmail, opts);
  await api(`/api/leads/${ctx.leadId}/complete`, { method: "POST", token: ctx.artisanToken });
  return ctx;
}

// --- Completion authorization ---

test("completion: the professional can complete their own eligible (hired) job", async () => {
  const { leadId, artisanToken } = await hiredLead("artisan1@example.com");
  const { status, data } = await api(`/api/leads/${leadId}/complete`, { method: "POST", token: artisanToken });
  assert.equal(status, 200);
  assert.equal(data.status, "completed");
});

test("completion: a client cannot invoke the professional completion action", async () => {
  const { leadId, clientToken } = await hiredLead("artisan1@example.com");
  const { status } = await api(`/api/leads/${leadId}/complete`, { method: "POST", token: clientToken });
  assert.equal(status, 403);
});

test("completion: an unrelated professional cannot complete someone else's job", async () => {
  const { leadId } = await hiredLead("artisan1@example.com");
  const otherArtisan = await login("artisan2@example.com");
  const { status } = await api(`/api/leads/${leadId}/complete`, { method: "POST", token: otherArtisan });
  assert.equal(status, 403);
});

test("completion: an invalid transition (completing a merely-contacted lead) is rejected", async () => {
  const { leadId, artisanToken } = await freshLead("artisan1@example.com");
  const { status } = await api(`/api/leads/${leadId}/complete`, { method: "POST", token: artisanToken });
  assert.equal(status, 400);
});

test("completion: the completed state persists", async () => {
  const { leadId, artisanToken } = await completedLead("artisan1@example.com");
  const { data } = await api(`/api/leads/${leadId}`, { token: artisanToken });
  assert.equal(data.status, "completed");
});

// --- Review eligibility ---

test("review eligibility: a completed job is reviewable", async () => {
  const { leadId, clientToken } = await completedLead("artisan1@example.com");
  const { status } = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 5, comment: "great" } });
  assert.equal(status, 201);
});

test("review eligibility: an incomplete (still hired) job cannot be reviewed", async () => {
  const { leadId, clientToken } = await hiredLead("artisan1@example.com");
  const { status } = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 5, comment: "" } });
  assert.equal(status, 400);
});

test("review eligibility: a not_hired job cannot be reviewed", async () => {
  const { leadId, artisanToken, clientToken } = await freshLead("artisan1@example.com");
  await api(`/api/leads/${leadId}/self-report`, { method: "POST", token: artisanToken, body: { outcome: "not_hired" } });
  const { status } = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 3, comment: "" } });
  assert.equal(status, 400);
});

test("review eligibility: an unrelated client cannot review someone else's lead", async () => {
  const { leadId } = await completedLead("artisan1@example.com", { clientEmail: "client1@example.com" });
  const otherClient = await login("client2@example.com");
  const { status } = await api("/api/reviews", { method: "POST", token: otherClient, body: { leadId, rating: 5, comment: "" } });
  assert.equal(status, 404);
});

test("review eligibility: a professional cannot review (client role required)", async () => {
  const { leadId, artisanToken } = await completedLead("artisan1@example.com");
  const { status } = await api("/api/reviews", { method: "POST", token: artisanToken, body: { leadId, rating: 5, comment: "" } });
  assert.equal(status, 403);
});

// --- Review creation ---

test("review creation: a valid 1-star review succeeds", async () => {
  const { leadId, clientToken } = await completedLead("artisan1@example.com");
  const { status } = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 1, comment: "not great" } });
  assert.equal(status, 201);
});

test("review creation: a valid 5-star review succeeds", async () => {
  const { leadId, clientToken } = await completedLead("artisan1@example.com");
  const { status } = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 5, comment: "excellent" } });
  assert.equal(status, 201);
});

test("review creation: an invalid rating is rejected", async () => {
  const { leadId, clientToken } = await completedLead("artisan1@example.com");
  const zero = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 0, comment: "" } });
  assert.equal(zero.status, 400);
  const six = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 6, comment: "" } });
  assert.equal(six.status, 400);
  const nonInt = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 3.5, comment: "" } });
  assert.equal(nonInt.status, 400);
});

test("review creation: malformed data is rejected", async () => {
  const { leadId, clientToken } = await completedLead("artisan1@example.com");
  const { status } = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: "five", comment: "" } });
  assert.equal(status, 400);
});

test("review creation: an over-length comment is rejected", async () => {
  const { leadId, clientToken } = await completedLead("artisan1@example.com");
  const { status } = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 4, comment: "x".repeat(1001) } });
  assert.equal(status, 400);
});

test("review creation: artisan_id and client_id are derived server-side, never client-supplied", async () => {
  const { leadId, clientToken } = await completedLead("artisan1@example.com");
  const created = await api("/api/reviews", {
    method: "POST",
    token: clientToken,
    body: { leadId, rating: 4, comment: "", artisan_id: 999999, client_id: 999999 },
  });
  assert.equal(created.status, 201);
  const review = await api(`/api/leads/${leadId}/review`, { token: clientToken });
  assert.notEqual(review.data.artisan_id, 999999);
  assert.notEqual(review.data.client_id, 999999);
});

// --- Duplicate prevention ---

test("duplicate prevention: the same lead cannot receive two reviews", async () => {
  const { leadId, clientToken } = await completedLead("artisan1@example.com");
  const first = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 4, comment: "" } });
  assert.equal(first.status, 201);
  const second = await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 2, comment: "changed my mind" } });
  assert.equal(second.status, 409);
});

test("duplicate prevention: concurrent duplicate submissions are safely rejected (only one succeeds)", async () => {
  const { leadId, clientToken } = await completedLead("artisan1@example.com");
  const [a, b] = await Promise.all([
    api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 5, comment: "a" } }),
    api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 1, comment: "b" } }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409], "exactly one of the two concurrent attempts must succeed");
});

// --- Ownership ---

test("ownership: a client cannot review a lead by guessing another client's leadId", async () => {
  const { leadId } = await completedLead("artisan1@example.com", { clientEmail: "client1@example.com" });
  const otherClient = await login("client3@example.com");
  const { status } = await api("/api/reviews", { method: "POST", token: otherClient, body: { leadId, rating: 5, comment: "" } });
  assert.equal(status, 404);
});

test("ownership: no route exists for a professional to edit a review", async () => {
  const { leadId, clientToken, artisanToken } = await completedLead("artisan1@example.com");
  await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 4, comment: "" } });
  const review = await api(`/api/leads/${leadId}/review`, { token: clientToken });
  const { status } = await fetch(`${BASE}/api/reviews/${review.data.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${artisanToken}` },
    body: JSON.stringify({ rating: 1 }),
  });
  assert.equal(status, 404, "no PUT /api/reviews/:id route should exist -- reviews are immutable");
});

test("ownership: no route exists for a professional to delete a review", async () => {
  const { leadId, clientToken, artisanToken } = await completedLead("artisan1@example.com");
  await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 4, comment: "" } });
  const review = await api(`/api/leads/${leadId}/review`, { token: clientToken });
  const { status } = await fetch(`${BASE}/api/reviews/${review.data.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${artisanToken}` },
  });
  assert.equal(status, 404, "no DELETE /api/reviews/:id route should exist -- reviews are immutable");
});

// --- Notifications ---

test("notifications: completion creates a review-request notification for the client", async () => {
  const { leadId, clientToken } = await hiredLead("artisan1@example.com", { clientEmail: "client1@example.com" });
  const artisanToken = await login("artisan1@example.com");
  await api(`/api/leads/${leadId}/complete`, { method: "POST", token: artisanToken });

  const list = await api("/api/notifications", { token: clientToken });
  const notif = list.data.results.find((n) => n.lead_id === leadId && n.type === "review_request");
  assert.ok(notif, "the client must receive a review_request notification");
});

test("notifications: the professional does not receive their own completion as a review request", async () => {
  const { leadId, artisanToken } = await hiredLead("artisan1@example.com");
  const baseline = (await api("/api/notifications", { token: artisanToken })).data.results.length;
  await api(`/api/leads/${leadId}/complete`, { method: "POST", token: artisanToken });
  const after = await api("/api/notifications", { token: artisanToken });
  const reviewRequests = after.data.results.filter((n) => n.type === "review_request");
  assert.equal(reviewRequests.length, 0, "review_request notifications must only ever go to clients");
});

test("notifications: contains correct lead and service context", async () => {
  const { leadId, clientToken, artisanToken } = await hiredLead("artisan1@example.com", { clientEmail: "client2@example.com" });
  await api(`/api/leads/${leadId}/complete`, { method: "POST", token: artisanToken });
  const list = await api("/api/notifications", { token: clientToken });
  const notif = list.data.results.find((n) => n.lead_id === leadId && n.type === "review_request");
  assert.equal(notif.lead_id, leadId);
  assert.ok(notif.service_id);
  assert.ok(notif.sender_name);
});

// --- Public display ---

test("public display: an artisan's review list shows a review just submitted for them", async () => {
  const { leadId, clientToken } = await completedLead("artisan3@example.com");
  await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 5, comment: "unique-marker-review-text" } });
  const profile = await api("/api/artisans/7"); // artisan3@example.com == user id 7
  assert.ok(profile.data.reviews.some((r) => r.comment === "unique-marker-review-text"));
});

test("public display: a review for one artisan never appears on another artisan's profile", async () => {
  const { leadId, clientToken } = await completedLead("artisan4@example.com");
  await api("/api/reviews", { method: "POST", token: clientToken, body: { leadId, rating: 5, comment: "artisan4-only-review-marker" } });
  const otherProfile = await api("/api/artisans/5"); // a different artisan
  assert.ok(!otherProfile.data.reviews.some((r) => r.comment === "artisan4-only-review-marker"));
});

// --- Regression ---

test("regression: auth, service search, artisan search, radius search, service CRUD, lead creation, chat, notifications, media all remain unaffected", async () => {
  const token = await login("admin@nearhandsat.com");
  assert.ok(token);

  const artisans = await api("/api/artisans");
  assert.equal(artisans.status, 200);

  const services = await api("/api/services?category=Electrician");
  assert.equal(services.status, 200);

  const radius = await api("/api/artisans?country=Algeria&city=Setif");
  assert.equal(radius.status, 200);

  const { leadId, clientToken, artisanToken } = await freshLead("artisan1@example.com");
  const detail = await api(`/api/leads/${leadId}`, { token: clientToken });
  assert.equal(detail.status, 200);

  const msg = await api(`/api/leads/${leadId}/messages`, { method: "POST", token: artisanToken, body: { content: "still works" } });
  assert.equal(msg.status, 201);

  const notifs = await api("/api/notifications/unread-count", { token: clientToken });
  assert.equal(notifs.status, 200);

  const unauthedMedia = await fetch(`${BASE}/api/media/nonexistent.png`);
  assert.equal(unauthedMedia.status, 401);
});

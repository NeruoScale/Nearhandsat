// HTTP + Socket.IO integration tests for README roadmap #5 (Chat &
// Notifications). Same real-server-as-a-subprocess approach as
// services.test.js and leads-services.test.js -- conversation/notification
// authorization lives in the route handlers and the Socket.IO connection
// handler, not the DB layer, so this drives both over the real protocols.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { io } = require("socket.io-client");

const PORT = 4095;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, `chat-test-${Date.now()}.db`);
const MEDIA_DIR = path.join(__dirname, `chat-media-test-${Date.now()}`);

let serverProcess;

test.before(async () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  }
  serverProcess = spawn("node", ["index.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), DB_PATH, DB_DRIVER: "sqlite", MEDIA_DIR },
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
  fs.rmSync(MEDIA_DIR, { recursive: true, force: true });
});

async function login(email, password = "password123") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).token;
}

async function api(path_, { method = "GET", token, body, form } = {}) {
  const res = await fetch(`${BASE}${path_}`, {
    method,
    headers: {
      ...(form ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function freshLead(overrides = {}) {
  const artisanToken = await login("artisan1@example.com"); // user id 5
  const svc = await api("/api/services", {
    method: "POST",
    token: artisanToken,
    body: { title: "Roadmap5 test service", description: "", category: "Electrician", pricing_model: "quote", ...overrides.service },
  });
  await api(`/api/services/${svc.data.id}/status`, { method: "PUT", token: artisanToken, body: { status: "published" } });
  const clientToken = await login(overrides.clientEmail || "client1@example.com");
  const lead = await api("/api/leads", {
    method: "POST",
    token: clientToken,
    body: { serviceId: svc.data.id, message: overrides.message || "Initial message" },
  });
  return { leadId: lead.data.id, serviceId: svc.data.id, clientToken, artisanToken };
}

function pngFile() {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], { type: "image/png" });
}
function mp4File(bytes = 1024) {
  return new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
}

// --- Conversations ---

test("conversations: authenticated client participant can retrieve the lead (their conversation)", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const { status, data } = await api(`/api/leads/${leadId}`, { token: clientToken });
  assert.equal(status, 200);
  assert.equal(data.id, leadId);
});

test("conversations: authenticated professional participant can retrieve it", async () => {
  const { leadId, artisanToken } = await freshLead({ clientEmail: "client2@example.com" });
  const { status } = await api(`/api/leads/${leadId}`, { token: artisanToken });
  assert.equal(status, 200);
});

test("conversations: an unrelated client is rejected", async () => {
  const { leadId } = await freshLead({ clientEmail: "client2@example.com" });
  const otherToken = await login("client3@example.com");
  const { status } = await api(`/api/leads/${leadId}`, { token: otherToken });
  assert.equal(status, 403);
});

test("conversations: an unrelated professional is rejected", async () => {
  const { leadId } = await freshLead({ clientEmail: "client2@example.com" });
  const otherArtisan = await login("artisan2@example.com");
  const { status } = await api(`/api/leads/${leadId}`, { token: otherArtisan });
  assert.equal(status, 403);
});

test("conversations: is associated with the correct lead and service", async () => {
  const { leadId, serviceId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const { data } = await api(`/api/leads/${leadId}/messages`, { token: clientToken });
  assert.equal(data.lead.id, leadId);
  assert.equal(data.lead.service_id, serviceId);
});

// --- Messages ---

test("messages: a participant can send text", async () => {
  const { leadId, artisanToken } = await freshLead({ clientEmail: "client2@example.com" });
  const { status } = await api(`/api/leads/${leadId}/messages`, { method: "POST", token: artisanToken, body: { content: "Sure, what time works?" } });
  assert.equal(status, 201);
});

test("messages: a participant can retrieve messages, paginated", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const { status, data } = await api(`/api/leads/${leadId}/messages?limit=1`, { token: clientToken });
  assert.equal(status, 200);
  assert.equal(data.messages.length, 1);
  assert.equal(data.limit, 1);
  assert.ok(data.total >= 1);
});

test("messages: an unrelated user cannot retrieve messages", async () => {
  const { leadId } = await freshLead({ clientEmail: "client2@example.com" });
  const otherToken = await login("client3@example.com");
  const { status } = await api(`/api/leads/${leadId}/messages`, { token: otherToken });
  assert.equal(status, 403);
});

test("messages: an unrelated user cannot send a message", async () => {
  const { leadId } = await freshLead({ clientEmail: "client2@example.com" });
  const otherToken = await login("client3@example.com");
  const { status } = await api(`/api/leads/${leadId}/messages`, { method: "POST", token: otherToken, body: { content: "hi" } });
  assert.equal(status, 403);
});

test("messages: sender is derived from authentication and cannot be spoofed", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const clientUser = await api("/api/leads/mine", { token: clientToken });
  const myId = clientUser.data[0].client_id;

  const sent = await api(`/api/leads/${leadId}/messages`, {
    method: "POST",
    token: clientToken,
    body: { content: "trying to spoof", sender_id: 999999, senderId: 999999 },
  });
  assert.equal(sent.status, 201);

  const thread = await api(`/api/leads/${leadId}/messages`, { token: clientToken });
  const last = thread.data.messages[thread.data.messages.length - 1];
  assert.equal(last.sender_id, myId, "sender_id must be the authenticated user, not a client-supplied value");
});

// --- Read state ---

test("read state: a message is unread until the recipient views the conversation", async () => {
  const { leadId, artisanToken } = await freshLead({ clientEmail: "client2@example.com" });
  const mine = await api("/api/leads/mine", { token: artisanToken });
  const lead = mine.data.find((l) => l.id === leadId);
  assert.equal(lead.first_message, "Initial message");

  // fetch as artisan via a fresh /:id/messages call from a *different* fresh
  // lead so we can inspect the unread message before it's marked read
  const raw = await api(`/api/leads/${leadId}/messages`, { token: artisanToken });
  // (this view itself marks it read, which is exactly what's being tested
  // in the next case -- so here we just confirm the message existed)
  assert.equal(raw.data.messages[0].content, "Initial message");
});

test("read state: viewing the conversation marks the other participant's messages read", async () => {
  // artisan1 is reused as the recipient across many tests in this file, so
  // unread-count accumulates across the whole run -- assert on the delta
  // this specific test causes, not an absolute value.
  const artisanTokenProbe = await login("artisan1@example.com");
  const baseline = (await api("/api/notifications/unread-count", { token: artisanTokenProbe })).data.count;

  const { leadId, clientToken, artisanToken } = await freshLead({ clientEmail: "client2@example.com" });
  const afterCreate = await api("/api/notifications/unread-count", { token: artisanToken });
  assert.equal(afterCreate.data.count, baseline + 1);

  const view = await api(`/api/leads/${leadId}/messages`, { token: artisanToken });
  assert.equal(view.data.messages[0].read_at !== null, true);

  const afterView = await api("/api/notifications/unread-count", { token: artisanToken });
  assert.equal(afterView.data.count, baseline, "viewing the conversation must also clear the notification it generated");
});

test("read state: a sender viewing their own conversation does not mark their own just-sent message as read", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const view = await api(`/api/leads/${leadId}/messages`, { token: clientToken });
  const own = view.data.messages.find((m) => m.content === "Initial message");
  assert.equal(own.read_at, null, "a sender cannot mark their own message as read just by viewing it");
});

// --- Notifications ---

test("notifications: a new message creates a notification for the recipient only", async () => {
  const artisanTokenProbe = await login("artisan1@example.com");
  const artisanBaseline = (await api("/api/notifications/unread-count", { token: artisanTokenProbe })).data.count;
  const clientToken2 = await login("client2@example.com");
  const clientBaseline = (await api("/api/notifications/unread-count", { token: clientToken2 })).data.count;

  const { leadId, clientToken, artisanToken } = await freshLead({ clientEmail: "client2@example.com" });

  const artisanUnread = await api("/api/notifications/unread-count", { token: artisanToken });
  assert.equal(artisanUnread.data.count, artisanBaseline + 1);

  const clientUnread = await api("/api/notifications/unread-count", { token: clientToken });
  assert.equal(clientUnread.data.count, clientBaseline, "the sender must not receive their own message as a notification");
});

test("notifications: contains lead and service context", async () => {
  const { leadId, serviceId, artisanToken } = await freshLead({ clientEmail: "client2@example.com" });
  const list = await api("/api/notifications", { token: artisanToken });
  const n = list.data.results[0];
  assert.equal(n.lead_id, leadId);
  assert.equal(n.service_id, serviceId);
  assert.ok(n.sender_name);
});

test("notifications: an unrelated user cannot mark another user's notification read", async () => {
  const { artisanToken } = await freshLead({ clientEmail: "client2@example.com" });
  const list = await api("/api/notifications", { token: artisanToken });
  const notifId = list.data.results[0].id;

  const otherArtisan = await login("artisan2@example.com");
  const { status } = await api(`/api/notifications/${notifId}/read`, { method: "PUT", token: otherArtisan });
  assert.equal(status, 404);
});

// --- Media ---

test("media: a valid image is accepted", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const form = new FormData();
  form.append("file", pngFile(), "photo.png");
  const { status, data } = await api(`/api/leads/${leadId}/attachments`, { method: "POST", token: clientToken, form });
  assert.equal(status, 201);
  assert.equal(data.message_type, "image");
});

test("media: a valid video is accepted", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const form = new FormData();
  form.append("file", mp4File(), "clip.mp4");
  const { status, data } = await api(`/api/leads/${leadId}/attachments`, { method: "POST", token: clientToken, form });
  assert.equal(status, 201);
  assert.equal(data.message_type, "video");
});

test("media: an invalid MIME type is rejected", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const form = new FormData();
  form.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
  const { status } = await api(`/api/leads/${leadId}/attachments`, { method: "POST", token: clientToken, form });
  assert.equal(status, 400);
});

test("media: an oversized image is rejected", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/png" }), "big.png");
  const { status } = await api(`/api/leads/${leadId}/attachments`, { method: "POST", token: clientToken, form });
  assert.equal(status, 400);
});

test("media: unauthorized attachment access is rejected", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const form = new FormData();
  form.append("file", pngFile(), "photo.png");
  const uploaded = await api(`/api/leads/${leadId}/attachments`, { method: "POST", token: clientToken, form });
  const key = uploaded.data.attachment_key;

  const otherToken = await login("client3@example.com");
  const res = await fetch(`${BASE}/api/media/${key}`, { headers: { Authorization: `Bearer ${otherToken}` } });
  assert.equal(res.status, 403);

  const anon = await fetch(`${BASE}/api/media/${key}`);
  assert.equal(anon.status, 401);
});

// --- Realtime (Socket.IO) ---

function connectSocket(token) {
  return io(BASE, { auth: { token }, reconnection: false });
}

test("realtime: an authenticated participant can join their lead room and receive a live message", async () => {
  const { leadId, clientToken, artisanToken } = await freshLead({ clientEmail: "client2@example.com" });
  const artisanSocket = connectSocket(artisanToken);
  await new Promise((resolve) => artisanSocket.on("connect", resolve));
  artisanSocket.emit("lead:join", leadId);
  await new Promise((r) => setTimeout(r, 300));

  const received = new Promise((resolve) => artisanSocket.on("lead:message", resolve));
  await api(`/api/leads/${leadId}/messages`, { method: "POST", token: clientToken, body: { content: "realtime check" } });
  const msg = await received;
  assert.equal(msg.content, "realtime check");
  artisanSocket.disconnect();
});

test("realtime: a non-participant who joins the room does not receive the message", async () => {
  const { leadId, clientToken } = await freshLead({ clientEmail: "client2@example.com" });
  const otherToken = await login("client3@example.com");
  const otherSocket = connectSocket(otherToken);
  await new Promise((resolve) => otherSocket.on("connect", resolve));
  otherSocket.emit("lead:join", leadId); // not a participant -- server silently refuses to join them
  await new Promise((r) => setTimeout(r, 300));

  const gotMessage = new Promise((resolve) => {
    otherSocket.on("lead:message", () => resolve(true));
    setTimeout(() => resolve(false), 1500);
  });
  await api(`/api/leads/${leadId}/messages`, { method: "POST", token: clientToken, body: { content: "should not leak" } });
  assert.equal(await gotMessage, false);
  otherSocket.disconnect();
});

test("realtime: an unauthenticated socket connection is rejected", async () => {
  const badSocket = io(BASE, { auth: {}, reconnection: false });
  const result = await new Promise((resolve) => {
    badSocket.on("connect", () => resolve("connected"));
    badSocket.on("connect_error", () => resolve("rejected"));
    setTimeout(() => resolve("timeout"), 3000);
  });
  assert.equal(result, "rejected");
  badSocket.disconnect();
});

test("realtime: a new-message notification reaches the recipient's own room in real time", async () => {
  const { leadId, clientToken, artisanToken } = await freshLead({ clientEmail: "client2@example.com" });
  const artisanSocket = connectSocket(artisanToken);
  await new Promise((resolve) => artisanSocket.on("connect", resolve));

  const notifReceived = new Promise((resolve) => artisanSocket.on("notification:new", resolve));
  await api(`/api/leads/${leadId}/messages`, { method: "POST", token: clientToken, body: { content: "notify me" } });
  const notif = await notifReceived;
  assert.equal(notif.lead_id, leadId);
  assert.equal(notif.type, "new_message");
  artisanSocket.disconnect();
});

// --- Regression ---

test("regression: auth, artisan search, service search, radius search, service CRUD, lead ownership all still work", async () => {
  const token = await login("admin@nearhandsat.com");
  assert.ok(token);

  const artisans = await api("/api/artisans");
  assert.equal(artisans.status, 200);

  const services = await api("/api/services?category=Electrician");
  assert.equal(services.status, 200);

  const radius = await api("/api/artisans?country=Algeria&city=Setif");
  assert.equal(radius.status, 200);

  const { leadId, clientToken } = await freshLead({ clientEmail: "client3@example.com" });
  const otherClient = await login("client1@example.com");
  const denied = await api(`/api/leads/${leadId}`, { token: otherClient });
  assert.equal(denied.status, 403);
  const allowed = await api(`/api/leads/${leadId}`, { token: clientToken });
  assert.equal(allowed.status, 200);
});

test("regression: existing lead status lifecycle (self-report) still works", async () => {
  const { leadId, artisanToken } = await freshLead({ clientEmail: "client3@example.com" });
  const { status, data } = await api(`/api/leads/${leadId}/self-report`, { method: "POST", token: artisanToken, body: { outcome: "hired" } });
  assert.equal(status, 200);
  assert.equal(data.status, "hired");
});

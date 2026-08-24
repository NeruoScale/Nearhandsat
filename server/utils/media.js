// Chat attachment storage (README roadmap #5). No object storage provider
// exists anywhere in this app -- this uses the Railway persistent volume
// mounted at /data (approved specifically for this phase; Railway's
// container filesystem is otherwise ephemeral, which is why nothing else
// in this app has ever stored files on local disk). Keys are always
// server-generated, never derived from a client-supplied filename, so
// there is no path-traversal surface: a lookup that doesn't match the
// generated key shape is rejected outright.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Defaults to the mounted Railway volume in production; locally (and in
// tests), RAILWAY_ENVIRONMENT is never set -- same signal already used by
// middleware/auth.js's JWT_SECRET guard -- so this falls back to a
// project-relative, gitignored directory instead of trying to create
// /data on a machine that doesn't have that volume mounted.
const STORAGE_DIR =
  process.env.MEDIA_DIR || (process.env.RAILWAY_ENVIRONMENT ? path.join("/data", "chat-media") : path.join(__dirname, "..", "chat-media"));
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const MAX_BYTES = { image: 5 * 1024 * 1024, video: 25 * 1024 * 1024 };

// Server-generated key shape: 32 hex chars + a fixed extension from the
// known-mime allowlist above -- nothing else is ever accepted as a valid
// key, which is what makes path traversal structurally impossible here.
const KEY_PATTERN = /^[a-f0-9]{32}\.(jpg|png|gif|webp|mp4|webm|mov)$/;

function kindForMime(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

function validate(mime, size) {
  const ext = MIME_EXTENSIONS[mime];
  if (!ext) return "Unsupported file type.";
  const kind = kindForMime(mime);
  if (size > MAX_BYTES[kind]) {
    const limitMb = MAX_BYTES[kind] / (1024 * 1024);
    return `File is too large (max ${limitMb}MB for ${kind}s).`;
  }
  return null;
}

// Writes `buffer` to a new, server-chosen key and returns
// { key, messageType } -- throws only for genuinely unexpected I/O
// failures; caller is expected to have already checked validate().
function save(buffer, mime) {
  const ext = MIME_EXTENSIONS[mime];
  const key = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(STORAGE_DIR, key), buffer);
  return { key, messageType: kindForMime(mime) };
}

function resolvePath(key) {
  if (!KEY_PATTERN.test(key)) return null;
  return path.join(STORAGE_DIR, key);
}

module.exports = { validate, save, resolvePath, MAX_BYTES, MIME_EXTENSIONS };

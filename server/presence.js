// In-memory presence tracking. Keyed by connection count rather than a
// plain Set so a user with multiple open tabs/devices isn't marked
// offline the moment just one of their sockets disconnects.
const onlineUsers = new Map();

function markOnline(userId) {
  onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1);
}

function markOffline(userId) {
  const remaining = (onlineUsers.get(userId) || 1) - 1;
  if (remaining <= 0) onlineUsers.delete(userId);
  else onlineUsers.set(userId, remaining);
}

function isOnline(userId) {
  return onlineUsers.has(userId);
}

module.exports = { markOnline, markOffline, isOnline };

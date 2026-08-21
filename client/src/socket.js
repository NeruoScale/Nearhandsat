import { io } from "socket.io-client";
import { getToken } from "./api";

let socket = null;

function getSocket() {
  if (!socket) {
    socket = io({ autoConnect: false, auth: { token: getToken() } });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  s.auth = { token: getToken() };
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket && socket.connected) socket.disconnect();
}

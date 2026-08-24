import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { connectSocket } from "../socket";

// Loads a lead's message thread over REST, joins its socket room for live
// updates, and falls back to a REST refetch on send if the socket isn't
// connected. Pass null/undefined for leadId to stay idle (e.g. collapsed).
export function useLeadThread(leadId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    setLoading(true);
    api
      .leadMessages(leadId)
      .then((thread) => {
        if (!cancelled) setMessages(thread.messages);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const socket = connectSocket();
    socketRef.current = socket;
    socket.emit("lead:join", leadId);

    function onMessage(msg) {
      if (String(msg.lead_id) !== String(leadId)) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    }
    socket.on("lead:message", onMessage);

    return () => {
      cancelled = true;
      socket.emit("lead:leave", leadId);
      socket.off("lead:message", onMessage);
    };
  }, [leadId]);

  const send = useCallback(
    async (content) => {
      await api.sendMessage(leadId, content);
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        const thread = await api.leadMessages(leadId);
        setMessages(thread.messages);
      }
    },
    [leadId]
  );

  const sendAttachment = useCallback(
    async (file, caption) => {
      const message = await api.sendAttachment(leadId, file, caption);
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      }
    },
    [leadId]
  );

  return { messages, loading, send, sendAttachment };
}

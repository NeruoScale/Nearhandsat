import React, { useEffect, useState } from "react";
import { fetchAttachmentUrl } from "../api";
import { useLanguage } from "../i18n";

// Renders an image/video chat message. The attachment endpoint is
// participant-only (requires the Authorization header), so this fetches it
// as a blob rather than using a plain <img>/<video> src -- see
// api.fetchAttachmentUrl. Revokes the object URL on unmount/key change to
// avoid leaking memory across a long chat session.
export default function ChatAttachment({ messageType, attachmentKey }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setUrl(null);
    setError(false);
    fetchAttachmentUrl(attachmentKey)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentKey]);

  if (error) return <div style={{ fontSize: 12, color: "var(--danger)" }}>{t.common.somethingWentWrong}</div>;
  if (!url) return <div style={{ fontSize: 12, color: "var(--steel)" }}>{t.common.loading}</div>;

  if (messageType === "video") {
    return <video src={url} controls style={{ maxWidth: 220, maxHeight: 200, borderRadius: 8, display: "block" }} />;
  }
  return <img src={url} alt="" style={{ maxWidth: 220, maxHeight: 200, borderRadius: 8, display: "block", objectFit: "cover" }} />;
}

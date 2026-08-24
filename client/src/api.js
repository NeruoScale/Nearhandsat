import { translations, STORAGE_KEY } from "./i18n";

let token = null;
export function setToken(t) {
  token = t;
}
export function getToken() {
  return token;
}

// Fetches a private chat attachment (GET /api/media/:key) as a blob and
// returns an object URL -- a plain <img>/<video> src can't attach the
// Authorization header this endpoint requires (it's participant-only, not
// a public static path), so this is the standard SPA workaround. Caller
// owns the returned URL and must URL.revokeObjectURL() it when done (see
// components/ChatAttachment.jsx).
export async function fetchAttachmentUrl(key) {
  const res = await fetch(`/api/media/${key}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Could not load attachment.");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function currentTranslations() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return translations[stored] || translations.en;
  } catch {
    return translations.en;
  }
}

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || currentTranslations().common.somethingWentWrong);
  return data;
}

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  searchArtisans: (params) => request(`/artisans?${new URLSearchParams(params).toString()}`),
  getArtisan: (id) => request(`/artisans/${id}`),
  addPortfolioItem: (payload) => request("/artisans/me/portfolio", { method: "POST", body: payload }),
  myPortfolio: () => request("/artisans/me/portfolio"),
  updatePortfolioItem: (id, payload) => request(`/artisans/me/portfolio/${id}`, { method: "PUT", body: payload }),
  hidePortfolioItem: (id) => request(`/artisans/me/portfolio/${id}/hide`, { method: "PUT" }),
  updateProfile: (payload) => request("/artisans/me", { method: "PUT", body: payload }),
  createLead: (payload) => request("/leads", { method: "POST", body: payload }),
  myLeads: () => request("/leads/mine"),
  getLead: (id) => request(`/leads/${id}`),
  leadMessages: (id, params) => request(`/leads/${id}/messages${params ? `?${new URLSearchParams(params).toString()}` : ""}`),
  sendMessage: (id, content) => request(`/leads/${id}/messages`, { method: "POST", body: { content } }),
  sendAttachment: async (id, file, caption) => {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    const res = await fetch(`/api/leads/${id}/attachments`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || currentTranslations().common.somethingWentWrong);
    return data;
  },
  confirmHire: (id) => request(`/leads/${id}/hire`, { method: "POST" }),
  selfReport: (id, outcome) => request(`/leads/${id}/self-report`, { method: "POST", body: { outcome } }),
  completeLead: (id) => request(`/leads/${id}/complete`, { method: "POST" }),
  getLeadReview: (id) => request(`/leads/${id}/review`),
  submitReview: (payload) => request("/reviews", { method: "POST", body: payload }),
  adminStats: () => request("/admin/stats"),
  adminFlagged: (params) => request(`/admin/flagged?${new URLSearchParams(params || {}).toString()}`),
  adminBilling: () => request("/admin/billing"),
  updateBilling: (id, payload) => request(`/admin/billing/${id}`, { method: "PUT", body: payload }),
  searchServices: (params) => request(`/services?${new URLSearchParams(params).toString()}`),
  getService: (id) => request(`/services/${id}`),
  myServices: () => request("/services/mine"),
  addService: (payload) => request("/services", { method: "POST", body: payload }),
  updateService: (id, payload) => request(`/services/${id}`, { method: "PUT", body: payload }),
  setServiceStatus: (id, status) => request(`/services/${id}/status`, { method: "PUT", body: { status } }),
  getNotifications: (params) => request(`/notifications?${new URLSearchParams(params || {}).toString()}`),
  getUnreadCount: () => request("/notifications/unread-count"),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: "PUT" }),
  markAllNotificationsRead: () => request("/notifications/read-all", { method: "POST" }),
};

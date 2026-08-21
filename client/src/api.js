let token = null;
export function setToken(t) {
  token = t;
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
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  searchArtisans: (params) => request(`/artisans?${new URLSearchParams(params).toString()}`),
  getArtisan: (id) => request(`/artisans/${id}`),
  addPortfolioItem: (payload) => request("/artisans/me/portfolio", { method: "POST", body: payload }),
  createLead: (payload) => request("/leads", { method: "POST", body: payload }),
  myLeads: () => request("/leads/mine"),
  leadMessages: (id) => request(`/leads/${id}/messages`),
  sendMessage: (id, content) => request(`/leads/${id}/messages`, { method: "POST", body: { content } }),
  confirmHire: (id) => request(`/leads/${id}/hire`, { method: "POST" }),
  selfReport: (id, outcome) => request(`/leads/${id}/self-report`, { method: "POST", body: { outcome } }),
  completeLead: (id) => request(`/leads/${id}/complete`, { method: "POST" }),
  submitReview: (payload) => request("/reviews", { method: "POST", body: payload }),
  adminStats: () => request("/admin/stats"),
  adminFlagged: () => request("/admin/flagged"),
  adminBilling: () => request("/admin/billing"),
  updateBilling: (id, payload) => request(`/admin/billing/${id}`, { method: "PUT", body: payload }),
};

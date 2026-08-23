import React, { useEffect, useState } from "react";
import { Plus, Pencil, Check, X as XIcon } from "lucide-react";
import { api } from "../api";
import { Tag } from "./Shared";
import TradeCombobox from "./TradeCombobox";
import { useLanguage } from "../i18n";

const EMPTY_FORM = { title: "", description: "", category: "", pricing_model: "starting_at", price: "", currency: "DZD" };

function priceLabel(s, t) {
  if (s.pricing_model === "quote") return t.services.contactForQuote;
  if (s.pricing_model === "starting_at") return t.services.startingFrom(s.price, s.currency);
  return t.services.fixedPrice(s.price, s.currency);
}

const STATUS_TONE = { draft: "steel", published: "green", archived: "steel" };

export default function ServiceManager() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  function load() {
    api.myServices().then(setItems);
  }
  useEffect(load, []);

  async function addItem(e) {
    e.preventDefault();
    setFormError("");
    try {
      await api.addService({
        title: form.title,
        description: form.description,
        category: form.category,
        pricing_model: form.pricing_model,
        price: form.pricing_model === "quote" ? undefined : Number(form.price),
        currency: form.currency,
      });
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setFormError(err.message);
    }
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditForm({
      title: item.title,
      description: item.description,
      category: item.category,
      pricing_model: item.pricing_model,
      price: item.price ?? "",
      currency: item.currency,
    });
  }

  async function saveEdit(id) {
    await api.updateService(id, {
      title: editForm.title,
      description: editForm.description,
      category: editForm.category,
      pricing_model: editForm.pricing_model,
      price: editForm.pricing_model === "quote" ? undefined : Number(editForm.price),
      currency: editForm.currency,
    });
    setEditingId(null);
    load();
  }

  async function setStatus(id, status) {
    await api.setServiceStatus(id, status);
    load();
  }

  function statusActions(item) {
    if (item.status === "draft") {
      return (
        <>
          <button className="btn-primary" style={{ padding: "6px 10px" }} onClick={() => setStatus(item.id, "published")}>
            {t.services.publish}
          </button>
          <button className="btn-secondary" style={{ padding: "6px 10px" }} onClick={() => setStatus(item.id, "archived")}>
            {t.services.archive}
          </button>
        </>
      );
    }
    if (item.status === "published") {
      return (
        <>
          <button className="btn-secondary" style={{ padding: "6px 10px" }} onClick={() => setStatus(item.id, "draft")}>
            {t.services.unpublish}
          </button>
          <button className="btn-secondary" style={{ padding: "6px 10px" }} onClick={() => setStatus(item.id, "archived")}>
            {t.services.archive}
          </button>
        </>
      );
    }
    return (
      <button className="btn-secondary" style={{ padding: "6px 10px" }} onClick={() => setStatus(item.id, "draft")}>
        {t.services.restoreToDraft}
      </button>
    );
  }

  return (
    <div>
      <form onSubmit={addItem} style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          style={{ flex: "1 1 180px" }}
          placeholder={t.services.titlePlaceholder}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <div style={{ flex: "1 1 160px" }}>
          <TradeCombobox value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder={t.services.categoryPlaceholder} />
        </div>
        <select
          className="input"
          style={{ flex: "0 1 150px" }}
          value={form.pricing_model}
          onChange={(e) => setForm({ ...form, pricing_model: e.target.value })}
        >
          <option value="fixed">{t.services.pricingModel.fixed}</option>
          <option value="starting_at">{t.services.pricingModel.starting_at}</option>
          <option value="quote">{t.services.pricingModel.quote}</option>
        </select>
        {form.pricing_model !== "quote" && (
          <input
            className="input"
            type="number"
            min="0"
            style={{ flex: "0 1 110px" }}
            placeholder={t.services.pricePlaceholder}
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        )}
        <input
          className="input"
          style={{ flex: "0 1 90px" }}
          placeholder={t.services.currencyPlaceholder}
          value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value })}
        />
        <textarea
          className="input"
          style={{ flex: "1 1 100%" }}
          placeholder={t.services.descriptionPlaceholder}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <button className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> {t.services.create}
        </button>
      </form>
      {formError && <div className="error-text">{formError}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {items.map((s) => (
          <div key={s.id} className="card" style={{ padding: 12 }}>
            {editingId === s.id ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input className="input" style={{ flex: "1 1 160px" }} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                <div style={{ flex: "1 1 140px" }}>
                  <TradeCombobox value={editForm.category} onChange={(v) => setEditForm({ ...editForm, category: v })} placeholder={t.services.categoryPlaceholder} />
                </div>
                <select className="input" style={{ flex: "0 1 150px" }} value={editForm.pricing_model} onChange={(e) => setEditForm({ ...editForm, pricing_model: e.target.value })}>
                  <option value="fixed">{t.services.pricingModel.fixed}</option>
                  <option value="starting_at">{t.services.pricingModel.starting_at}</option>
                  <option value="quote">{t.services.pricingModel.quote}</option>
                </select>
                {editForm.pricing_model !== "quote" && (
                  <input className="input" type="number" min="0" style={{ flex: "0 1 110px" }} value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} />
                )}
                <input className="input" style={{ flex: "0 1 90px" }} value={editForm.currency} onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })} />
                <textarea className="input" style={{ flex: "1 1 100%" }} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                <button className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={() => saveEdit(s.id)}>
                  <Check size={14} /> {t.portfolio.save}
                </button>
                <button className="btn-secondary" style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={() => setEditingId(null)}>
                  <XIcon size={14} /> {t.portfolio.cancel}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, color: "#3C3A33" }}>
                  <strong style={{ color: "var(--navy)" }}>{s.title}</strong> — {s.category}
                  <span style={{ marginLeft: 6 }}>
                    <Tag tone={STATUS_TONE[s.status]}>{t.services.status[s.status]}</Tag>
                  </span>
                  <div style={{ fontSize: 12, color: "var(--steel)", marginTop: 3 }}>{priceLabel(s, t)}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                  <button className="btn-secondary" style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px" }} onClick={() => startEdit(s)}>
                    <Pencil size={13} /> {t.portfolio.edit}
                  </button>
                  {statusActions(s)}
                </div>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <div style={{ fontSize: 13, color: "var(--steel)" }}>{t.services.noServices}</div>}
      </div>
    </div>
  );
}

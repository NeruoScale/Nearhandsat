import React, { useState } from "react";
import { TRADES } from "../constants/trades";

export default function TradeCombobox({ value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const query = value || "";
  const matches = query
    ? TRADES.filter((t) => t.toLowerCase().includes(query.toLowerCase()))
    : TRADES;

  function selectTrade(trade) {
    onChange(trade);
    setOpen(false);
    setHighlighted(-1);
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setHighlighted(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (highlighted >= 0 && matches[highlighted]) {
        e.preventDefault();
        selectTrade(matches[highlighted]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 && (
        <div
          className="card"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            insetInlineStart: 0,
            insetInlineEnd: 0,
            zIndex: 20,
            maxHeight: 220,
            overflowY: "auto",
            padding: 4,
          }}
        >
          {matches.map((t, i) => (
            <div
              key={t}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectTrade(t)}
              style={{
                padding: "8px 10px",
                borderRadius: 5,
                fontSize: 13,
                cursor: "pointer",
                background: i === highlighted ? "var(--amber)" : "transparent",
                color: i === highlighted ? "#2A1B04" : "#1A1A17",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

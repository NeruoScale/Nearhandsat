import React, { useState } from "react";

// Generic filter-as-you-type combobox: case-insensitive substring match,
// arrow-key nav, Enter to select, Escape to close, click-to-select.
// Shared by TradeCombobox and LocationPicker rather than duplicated.
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  minChars = 0,
  maxResults = 200,
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const query = value || "";
  const meetsThreshold = query.length >= minChars;
  const filtered = meetsThreshold ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())) : [];
  const matches = filtered.slice(0, maxResults);

  function select(opt) {
    onChange(opt);
    setOpen(false);
    setHighlighted(-1);
  }

  function handleKeyDown(e) {
    if (disabled) return;
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
        select(matches[highlighted]);
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
        value={value || ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {open && !disabled && matches.length > 0 && (
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
          {matches.map((opt, i) => (
            <div
              key={opt}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(opt)}
              style={{
                padding: "8px 10px",
                borderRadius: 5,
                fontSize: 13,
                cursor: "pointer",
                background: i === highlighted ? "var(--amber)" : "transparent",
                color: i === highlighted ? "#2A1B04" : "#1A1A17",
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

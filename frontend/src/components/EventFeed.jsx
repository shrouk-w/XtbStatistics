import { useState } from "react";
import { formatDate } from "../utils/format.js";

export function EventFeed({
  title,
  eyebrow,
  events,
  emptyText,
  customEvents,
  setCustomEvents,
  onError,
  withAddBox = false,
}) {
  const [eventInput, setEventInput] = useState("");

  function handleAddEvent() {
    if (!eventInput.trim()) return;
    const [rawDate, ...labelParts] = eventInput.split("|");
    const date = rawDate.trim();
    const label = labelParts.join("|").trim() || "Event";

    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setCustomEvents((prev) => [
        ...prev,
        { key: `custom-${Date.now()}`, date, title: label, source: "custom" },
      ]);
      setEventInput("");
    } else if (onError) {
      onError("Invalid format. Use YYYY-MM-DD | Label");
    }
  }

  function handleRemove(key) {
    setCustomEvents((prev) => prev.filter((e) => e.key !== key));
  }

  return (
    <aside className="sidePanel">
      <div className="panelHead compact">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>

      {withAddBox ? (
        <div className="eventAddBox">
          <input
            type="text"
            value={eventInput}
            onChange={(e) => setEventInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddEvent()}
            placeholder="YYYY-MM-DD | Event Name"
          />
          <button onClick={handleAddEvent}>Add</button>
        </div>
      ) : null}

      <div className="eventList">
        {events.length ? (
          events.map((event) => (
            <article key={event.key} className={event.source === "custom" ? "customEvent" : ""}>
              <time>{formatDate(event.date)}</time>
              <strong>{event.title}</strong>
              {event.value ? <span>{event.value}</span> : null}
              {event.source === "custom" && (
                <button
                  className="removeEventBtn"
                  onClick={() => handleRemove(event.key)}
                  title="Remove event"
                >×</button>
              )}
            </article>
          ))
        ) : (
          <p>{emptyText}</p>
        )}
      </div>
    </aside>
  );
}

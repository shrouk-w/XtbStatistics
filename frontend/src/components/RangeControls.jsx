export function RangeControls({ data, startDate, endDate, onStartDate, onEndDate }) {
  function setPreset(days) {
    if (!data?.summary) return;

    if (days === "all") {
      onStartDate(data.summary.startDate);
      onEndDate(data.summary.endDate);
      return;
    }

    const end = new Date(`${data.summary.endDate}T00:00:00`);
    const start = new Date(end);
    if (days === "ytd") {
      start.setMonth(0, 1);
    } else {
      start.setDate(start.getDate() - days);
    }

    onStartDate(start.toISOString().slice(0, 10));
    onEndDate(data.summary.endDate);
  }

  return (
    <div className="controlCluster">
      <div className="segmented">
        <button type="button" onClick={() => setPreset(30)}>1M</button>
        <button type="button" onClick={() => setPreset(90)}>3M</button>
        <button type="button" onClick={() => setPreset(180)}>6M</button>
        <button type="button" onClick={() => setPreset("ytd")}>YTD</button>
        <button type="button" onClick={() => setPreset(365)}>1Y</button>
        <button type="button" onClick={() => setPreset("all")}>ALL</button>
      </div>
      <div className="dateInputs">
        <label>
          <span>Start</span>
          <input type="date" value={startDate} onChange={(e) => onStartDate(e.target.value)} />
        </label>
        <label>
          <span>End</span>
          <input type="date" value={endDate} onChange={(e) => onEndDate(e.target.value)} />
        </label>
      </div>
    </div>
  );
}

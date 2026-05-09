import { formatPln, formatDate } from "../utils/format.js";
import { BENCHMARK_COLORS } from "../constants.js";

export function LiveTooltip({
  hoverPoint,
  benchmarks,
  visibleSeries,
  valueKey,
  valueLabel,
  activeBenchmarks,
  benchmarkValueKey = "value",
}) {
  const displayPoint = hoverPoint || (visibleSeries && visibleSeries.length > 0 ? visibleSeries[visibleSeries.length - 1] : null);

  if (!displayPoint) {
    return <div className="liveTooltip placeholder">Waiting for portfolio data...</div>;
  }

  const activeBenchmarkSeries = Object.entries(benchmarks ?? {})
    .filter(([key]) => activeBenchmarks[key])
    .map(([key, benchmark]) => {
      const point = benchmark.series.find((p) => p.date === displayPoint.date);
      return point ? { ...benchmark, current: point, key } : null;
    })
    .filter(Boolean);

  return (
    <div className={`liveTooltip ${hoverPoint ? "active" : "default"}`}>
      <div className="tipDate">
        <span>{hoverPoint ? formatDate(displayPoint.date) : "Latest: " + formatDate(displayPoint.date)}</span>
      </div>
      <div className="tipContent">
        <div className="tipGroup">
          <label>{valueLabel}</label>
          <strong>{formatPln(displayPoint[valueKey])}</strong>
        </div>
        <div className="tipGroup">
          <label>Cash</label>
          <strong>{formatPln(displayPoint.cash)}</strong>
        </div>
        <div className="tipGroup">
          <label>Holdings</label>
          <strong>{formatPln(displayPoint.holdingsValue)}</strong>
        </div>
      </div>
      <div className="tipBenchmarks">
        {activeBenchmarkSeries.length > 0 ? (
          activeBenchmarkSeries.map((b) => (
            <div key={b.key} className="tipBenchRow">
              <span className="dot" style={{ background: BENCHMARK_COLORS[b.key] }} />
              <span className="label">{b.label}</span>
              <strong>{formatPln(b.current[benchmarkValueKey])}</strong>
            </div>
          ))
        ) : (
          <span className="noBenchmarks">Toggle benchmarks to compare</span>
        )}
      </div>
    </div>
  );
}

import { BENCHMARK_COLORS } from "../constants.js";

export function BenchmarkToggles({ benchmarks, active, onToggle }) {
  const entries = Object.entries(benchmarks ?? {});
  if (!entries.length) return null;

  return (
    <div className="benchmarkToggles">
      {entries.map(([key, benchmark]) => (
        <label key={key} className="togglePill">
          <input
            type="checkbox"
            checked={Boolean(active[key])}
            onChange={() => onToggle(key)}
          />
          <span style={{ "--dot": BENCHMARK_COLORS[key] ?? "#7cf6d2" }}>
            {benchmark.label}
          </span>
        </label>
      ))}
    </div>
  );
}

import { useId } from "react";
import { formatPlnCompact, formatDate, formatDateShort } from "../utils/format.js";
import { clamp, linePath, niceTicks } from "../utils/portfolio.js";
import {
  BENCHMARK_COLORS,
  CHART_INK,
  CHART_HAIR,
  CHART_MUTED,
  CHART_LOSS,
  CHART_EVENT,
} from "../constants.js";

export function PortfolioChart({
  series,
  benchmarks,
  activeBenchmarks,
  events,
  hoverIndex,
  onHover,
  valueKey = "totalValue",
  benchmarkValueKey = "value",
  showZeroLine = true,
  startAtZero = false,
}) {
  const width = 1120;
  const height = 420;
  const padLeft = 56;
  const padRight = 24;
  const padTop = 24;
  const padBottom = 44;
  const fillId = useId().replace(/:/g, "");

  if (!series.length) {
    return <div className="chartEmpty">No data in selected range.</div>;
  }

  const activeBenchmarkSeries = Object.entries(benchmarks ?? {})
    .filter(([key]) => activeBenchmarks[key])
    .map(([key, benchmark]) => ({
      key,
      label: benchmark.label,
      color: BENCHMARK_COLORS[key] ?? "#7cf6d2",
      series: benchmark.series.filter((point) =>
        series.some((portfolioPoint) => portfolioPoint.date === point.date)
      ),
    }));

  const allValues = [
    ...series.map((point) => Number(point[valueKey]) || 0),
    ...activeBenchmarkSeries.flatMap((benchmark) =>
      benchmark.series.map((point) => Number(point[benchmarkValueKey]) || 0)
    ),
  ];
  const rawMin = allValues.length ? Math.min(...allValues) : 0;
  const rawMax = allValues.length ? Math.max(...allValues) : 1;
  const rawRange = rawMax - rawMin || Math.abs(rawMax) || 1;
  const headroom = rawRange * 0.08;

  const lowEdge = startAtZero ? 0 : rawMin - headroom;
  const highEdge = rawMax + headroom;
  const ticks = niceTicks(lowEdge, highEdge, 5);
  const floor = ticks[0];
  const ceil = ticks[ticks.length - 1];
  const range = ceil - floor || 1;

  const innerH = height - padTop - padBottom;
  const innerW = width - padLeft - padRight;

  function toPoint(point, index, length, pointValueKey = valueKey) {
    const x = padLeft + (index / Math.max(length - 1, 1)) * innerW;
    const v = (Number(point[pointValueKey]) || 0);
    const y = padTop + innerH - ((v - floor) / range) * innerH;
    return { ...point, x, y };
  }

  const chartPoints = series.map((point, index) => toPoint(point, index, series.length));
  const benchmarkPoints = activeBenchmarkSeries.map((benchmark) => ({
    ...benchmark,
    points: benchmark.series.map((point, index) =>
      toPoint(point, index, benchmark.series.length, benchmarkValueKey)
    ),
  }));
  const hoverPoint =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < chartPoints.length
      ? chartPoints[hoverIndex]
      : null;

  function handleMouseMove(event) {
    if (!chartPoints.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = (event.clientX - rect.left) * (width / rect.width);
    const ratio = clamp((localX - padLeft) / innerW, 0, 1);
    const index = Math.round(ratio * (chartPoints.length - 1));
    onHover(index);
  }

  // Area fill under the portfolio line
  const baselineY = padTop + innerH;
  const portfolioLine = linePath(chartPoints);
  const portfolioArea =
    chartPoints.length > 0
      ? `${portfolioLine} L ${chartPoints.at(-1).x.toFixed(2)} ${baselineY} L ${chartPoints[0].x.toFixed(2)} ${baselineY} Z`
      : "";

  // Zero baseline (only if range crosses zero)
  const zeroY = padTop + innerH - ((0 - floor) / range) * innerH;
  const reallyShowZeroLine = showZeroLine && floor < 0 && ceil > 0;

  // X tick positions — show 5 dates, never overlapping
  const xTickIndices = [0, 0.25, 0.5, 0.75, 1].map((r) =>
    Math.floor(r * (series.length - 1))
  );

  // Hover date pill at the bottom rail
  const dateLabelText = hoverPoint ? formatDate(hoverPoint.date) : "";
  const dateLabelWidth = Math.max(64, dateLabelText.length * 6 + 18);

  return (
    <div className="chartShell">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chartSvg"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => onHover(null)}
      >
        <defs>
          <linearGradient id={`fill-${fillId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_INK} stopOpacity="0.10" />
            <stop offset="100%" stopColor={CHART_INK} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* horizontal hairline grid */}
        {ticks.map((tick) => {
          const y = padTop + innerH - ((tick - floor) / range) * innerH;
          return (
            <g key={`y-${tick}`}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke={CHART_HAIR} />
              <text
                x={padLeft - 10}
                y={y + 3}
                textAnchor="end"
                fill={CHART_MUTED}
                fontSize="10"
              >
                {formatPlnCompact(tick)}
              </text>
            </g>
          );
        })}

        {/* zero baseline (loss territory) */}
        {reallyShowZeroLine && (
          <g key="zero-line">
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={zeroY}
              y2={zeroY}
              stroke={CHART_LOSS}
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.7"
            />
            <text
              x={padLeft - 10}
              y={zeroY + 3}
              textAnchor="end"
              fill={CHART_LOSS}
              fontSize="10"
              fontWeight="500"
            >
              0 zł
            </text>
          </g>
        )}

        {/* x-axis date labels */}
        {series.length > 1 &&
          xTickIndices.map((idx) => {
            const point = chartPoints[idx];
            return (
              <g key={`x-${idx}`}>
                <line
                  x1={point.x}
                  x2={point.x}
                  y1={padTop + innerH - 4}
                  y2={padTop + innerH + 4}
                  stroke={CHART_HAIR}
                />
                <text
                  x={point.x}
                  y={padTop + innerH + 22}
                  textAnchor="middle"
                  fill={CHART_MUTED}
                  fontSize="10"
                  letterSpacing="0.04em"
                >
                  {formatDateShort(point.date).toUpperCase()}
                </text>
              </g>
            );
          })}

        {/* axes */}
        <line x1={padLeft} x2={padLeft} y1={padTop} y2={padTop + innerH} stroke={CHART_HAIR} />
        <line x1={padLeft} x2={width - padRight} y1={padTop + innerH} y2={padTop + innerH} stroke={CHART_HAIR} />

        {/* portfolio area fill */}
        <path d={portfolioArea} fill={`url(#fill-${fillId})`} />

        {/* benchmark lines */}
        {benchmarkPoints.map((benchmark) => (
          <path
            key={benchmark.key}
            d={linePath(benchmark.points)}
            fill="none"
            stroke={benchmark.color}
            strokeWidth="1.4"
            strokeDasharray="3 3"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.85"
          />
        ))}

        {/* portfolio line */}
        <path
          d={portfolioLine}
          fill="none"
          stroke={CHART_INK}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* milestone markers */}
        {events.map((event) => {
          const idx = series.findIndex((p) => p.date === event.date);
          if (idx < 0) return null;
          const p = chartPoints[idx];
          return (
            <g key={event.key}>
              <line
                x1={p.x}
                x2={p.x}
                y1={padTop}
                y2={padTop + innerH}
                stroke={CHART_EVENT}
                strokeDasharray="2 4"
                opacity="0.35"
              />
              <circle cx={p.x} cy={p.y} r="3.5" fill={CHART_EVENT} stroke="#FFFFFF" strokeWidth="1.5" />
            </g>
          );
        })}

        {/* hover crosshair + tags */}
        {hoverPoint && (
          <g>
            <line
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={padTop}
              y2={padTop + innerH}
              stroke={CHART_INK}
              strokeDasharray="3 3"
              opacity="0.4"
            />
            <circle
              cx={hoverPoint.x}
              cy={hoverPoint.y}
              r="6"
              fill={CHART_INK}
              opacity="0.08"
            />
            <circle
              cx={hoverPoint.x}
              cy={hoverPoint.y}
              r="3.5"
              fill={CHART_INK}
              stroke="#FFFFFF"
              strokeWidth="1.5"
            />
            <g
              transform={`translate(${clamp(
                hoverPoint.x - dateLabelWidth / 2,
                padLeft,
                width - padRight - dateLabelWidth
              )}, ${padTop + innerH + 6})`}
            >
              <rect
                width={dateLabelWidth}
                height="18"
                rx="3"
                fill={CHART_INK}
              />
              <text
                x={dateLabelWidth / 2}
                y="12"
                textAnchor="middle"
                fill="#FAFAF7"
                fontSize="10"
                fontWeight="500"
                letterSpacing="0.02em"
              >
                {dateLabelText}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

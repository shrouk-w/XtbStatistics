import { formatPln } from "./format.js";

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function linePath(points) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

// Returns evenly-spaced "nice" tick values across [min, max].
// Picks step from {1, 2, 5} × 10ⁿ so labels read 0, 2k, 4k... not 1.85k, 3.7k...
export function niceTicks(min, max, count = 5) {
  if (max === min) return [min];
  const range = max - min;
  const rawStep = range / Math.max(count - 1, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let step;
  if (normalized < 1.5) step = 1;
  else if (normalized < 3) step = 2;
  else if (normalized < 7) step = 5;
  else step = 10;
  step *= magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

export function filterByDate(series, startDate, endDate) {
  return series.filter((point) => {
    if (startDate && point.date < startDate) return false;
    if (endDate && point.date > endDate) return false;
    return true;
  });
}

export function buildPortfolioEvents(series, customEvents) {
  if (!series.length) return [];
  const peak = series.reduce((best, point) =>
    Number(point.totalValue) > Number(best.totalValue) ? point : best
  );

  const systemEvents = [
    {
      key: "peak",
      date: peak.date,
      title: "Portfolio high",
      value: formatPln(peak.totalValue),
      source: "system",
      order: 0,
    },
  ];

  const mappedCustom = customEvents
    .map((ce) => {
      const point = series.find((p) => p.date === ce.date);
      if (!point) return null;
      return { ...ce, value: formatPln(point.totalValue), order: 100 };
    })
    .filter(Boolean);

  return [...systemEvents, ...mappedCustom].sort(
    (a, b) => a.order - b.order || b.date.localeCompare(a.date)
  );
}

export function buildProfitEvents(series, customEvents) {
  if (!series.length) return [];

  const profitPeak = series.reduce((best, point) =>
    Number(point.profitValue) > Number(best.profitValue) ? point : best
  );
  const profitTrough = series.reduce((best, point) =>
    Number(point.profitValue) < Number(best.profitValue) ? point : best
  );

  let biggestProfitJump = null;
  let biggestProfitDrop = null;

  for (let index = 1; index < series.length; index += 1) {
    const previous = Number(series[index - 1].profitValue) || 0;
    const current = Number(series[index].profitValue) || 0;
    const change = current - previous;

    if (change > 0) {
      if (!biggestProfitJump || change > biggestProfitJump.change) {
        biggestProfitJump = { date: series[index].date, change };
      }
    } else if (change < 0) {
      if (!biggestProfitDrop || change < biggestProfitDrop.change) {
        biggestProfitDrop = { date: series[index].date, change };
      }
    }
  }

  const systemEvents = [
    { key: "profit-peak", date: profitPeak.date, title: "Profit high", value: formatPln(profitPeak.profitValue), source: "system", order: 0 },
    { key: "profit-trough", date: profitTrough.date, title: "Profit low", value: formatPln(profitTrough.profitValue), source: "system", order: 1 },
    biggestProfitJump
      ? { key: "profit-jump", date: biggestProfitJump.date, title: "Largest profit jump", value: formatPln(biggestProfitJump.change), source: "system", order: 2 }
      : null,
    biggestProfitDrop
      ? { key: "profit-drop", date: biggestProfitDrop.date, title: "Largest profit drop", value: formatPln(biggestProfitDrop.change), source: "system", order: 3 }
      : null,
  ].filter(Boolean);

  const mappedCustom = customEvents
    .map((ce) => {
      const point = series.find((p) => p.date === ce.date);
      if (!point) return null;
      return { ...ce, value: formatPln(point.profitValue), order: 100 };
    })
    .filter(Boolean);

  return [...systemEvents, ...mappedCustom].sort(
    (a, b) => a.order - b.order || b.date.localeCompare(a.date)
  );
}

export function buildStats(series) {
  if (!series.length) {
    return { current: 0, returnPercent: 0, drawdownPercent: 0, investedPercent: 0, avgDepositProfitPercent: 0 };
  }

  const first = Number(series[0].totalValue) || 0;
  const lastPoint = series[series.length - 1];
  const last = Number(lastPoint.totalValue) || 0;
  const holdingsValue = Number(lastPoint.holdingsValue) || 0;
  const profitValue = Number(lastPoint.profitValue) || 0;
  const peak = Math.max(...series.map((point) => Number(point.totalValue) || 0));

  const avgDeposit = series.reduce((sum, p) => sum + (Number(p.externalCashFlow) || 0), 0) / series.length;
  const avgDepositProfitPercent = avgDeposit > 0 ? (profitValue / avgDeposit) * 100 : 0;

  return {
    current: last,
    returnPercent: first ? ((last - first) / first) * 100 : 0,
    drawdownPercent: peak ? ((last - peak) / peak) * 100 : 0,
    investedPercent: last ? ((Number(holdingsValue) || 0) / last) * 100 : 0,
    avgDepositProfitPercent,
  };
}

import { useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

function formatPln(value) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("pl-PL", {
    maximumFractionDigits: 6,
  }).format(value ?? 0);
}

export function App() {
  const [files, setFiles] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const chartData = useMemo(() => data?.series ?? [], [data]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!files.length) {
      setError("Dodaj przynajmniej jeden plik XLSX z XTB.");
      return;
    }

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/portfolio/analyze`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Nie udalo sie przeliczyc portfela.");
      }
      const payload = await response.json();
      setData(payload);
    } catch (submitError) {
      setError(submitError.message || "Wystapil blad podczas wysylki.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">XTB Portfolio History</p>
          <h1>Wykres wartosci portfela dzien po dniu z eksportu XTB</h1>
          <p className="lede">
            Wrzuć jeden lub kilka plikow XLSX. Backend odtwarza cash, otwarte i zamkniete
            pozycje oraz przelicza notowania historyczne do PLN.
          </p>
        </div>

        <form className="uploadCard" onSubmit={handleSubmit}>
          <label className="uploadField">
            <span>Pliki XTB</span>
            <input
              type="file"
              accept=".xlsx"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>

          <button className="primaryButton" type="submit" disabled={loading}>
            {loading ? "Przeliczam..." : "Buduj wykres"}
          </button>

          <div className="selectedFiles">
            {files.length
              ? files.map((file) => <span key={file.name}>{file.name}</span>)
              : "Brak wybranych plikow"}
          </div>

          {error ? <p className="errorBox">{error}</p> : null}
        </form>
      </section>

      {data ? (
        <>
          <section className="metrics">
            <MetricCard label="Aktualna wartosc konta" value={formatPln(data.summary.currentTotalValue)} />
            <MetricCard label="Gotowka" value={formatPln(data.summary.currentCash)} />
            <MetricCard label="Wartosc aktywow" value={formatPln(data.summary.currentHoldingsValue)} />
            <MetricCard label="Szczyt" value={formatPln(data.summary.peakValue)} />
          </section>

          <section className="panel chartPanel">
            <div className="panelHeader">
              <div>
                <p className="panelEyebrow">Seria dzienna</p>
                <h2>Laczna wartosc portfela</h2>
              </div>
              <p className="dateRange">
                {data.summary.startDate} - {data.summary.endDate}
              </p>
            </div>

            <PortfolioChart data={chartData} />
          </section>

          <section className="grid">
            <div className="panel">
              <div className="panelHeader">
                <div>
                  <p className="panelEyebrow">Aktualny stan</p>
                  <h2>Otwarte pozycje</h2>
                </div>
              </div>

              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Ilosc</th>
                      <th>Kurs PLN</th>
                      <th>Wartosc PLN</th>
                      <th>Waluta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.holdings.length ? (
                      data.holdings.map((holding) => (
                        <tr key={holding.ticker}>
                          <td>{holding.ticker}</td>
                          <td>{formatNumber(holding.quantity)}</td>
                          <td>{formatPln(holding.pricePln)}</td>
                          <td>{formatPln(holding.marketValuePln)}</td>
                          <td>{holding.currency}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5">Brak otwartych pozycji po przeliczeniu.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <div className="panelHeader">
                <div>
                  <p className="panelEyebrow">Uwagi</p>
                  <h2>Zrodla i ostrzezenia</h2>
                </div>
              </div>

              <div className="notes">
                <p>
                  Ceny historyczne sa pobierane z Yahoo Finance przez biblioteke <code>yfinance</code>.
                  To wygodne zrodlo z szerokim pokryciem gield, ale nie jest oficjalnym API Yahoo.
                </p>
                {data.warnings.length ? (
                  <ul>
                    {data.warnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <p>Brak ostrzezen dla tego importu.</p>
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function MetricCard({ label, value }) {
  return (
    <article className="metricCard">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function PortfolioChart({ data }) {
  const width = 1080;
  const height = 420;
  const padding = 28;

  const values = data.map((point) => Number(point.totalValue) || 0);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const range = maxValue - minValue || 1;

  const path = data
    .map((point, index) => {
      const x = padding + (index / Math.max(data.length - 1, 1)) * (width - padding * 2);
      const y =
        height -
        padding -
        (((Number(point.totalValue) || 0) - minValue) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const lastPoint = data[data.length - 1];
  const firstPoint = data[0];

  return (
    <div className="chartWrap">
      {data.length ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="chartSvg" role="img" aria-label="Wykres portfela">
            <defs>
              <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(13, 122, 104, 0.28)" />
                <stop offset="100%" stopColor="rgba(13, 122, 104, 0.03)" />
              </linearGradient>
            </defs>

            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="axisLine" />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="axisLine" />

            <path
              d={`${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`}
              fill="url(#chart-fill)"
            />
            <path d={path} fill="none" stroke="#0d7a68" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
          </svg>

          <div className="chartLegend">
            <span>Poczatek: {firstPoint?.date}</span>
            <span>Koniec: {lastPoint?.date}</span>
            <span>Min: {formatPln(minValue)}</span>
            <span>Max: {formatPln(maxValue)}</span>
          </div>
        </>
      ) : (
        <div className="chartEmpty">Brak danych do narysowania wykresu.</div>
      )}
    </div>
  );
}

import { HoldingInsight } from "../components/HoldingInsight.jsx";
import { HoldingsTable } from "../components/HoldingsTable.jsx";

export function HoldingsPage({ data }) {
  const holdings = data?.holdings ?? [];
  const warnings = data?.warnings ?? [];

  return (
    <section className="lowerGrid">
      <div className="dataPanel">
        <div className="panelHead compact">
          <div>
            <span>Analyst consensus</span>
            <h2>Freshest available signal</h2>
          </div>
        </div>
        <div className="insightList">
          {holdings.length ? (
            holdings.map((holding) => <HoldingInsight key={holding.ticker} holding={holding} />)
          ) : (
            <p className="emptyState">No open holdings.</p>
          )}
        </div>
      </div>

      <HoldingsTable holdings={holdings} warnings={warnings} />
    </section>
  );
}

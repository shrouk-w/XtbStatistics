import { formatNumber, formatPln } from "../utils/format.js";

export function HoldingsTable({ holdings, warnings }) {
  return (
    <div className="dataPanel">
      <div className="panelHead compact">
        <div>
          <span>Positions</span>
          <h2>Open book</h2>
        </div>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Qty</th>
              <th>Original price</th>
              <th>Original value</th>
              <th>Value PLN</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => (
              <tr key={holding.ticker}>
                <td>{holding.ticker}</td>
                <td>{formatNumber(holding.quantity, 6)}</td>
                <td>{formatNumber(holding.priceOriginal, 4)} {holding.originalCurrency}</td>
                <td>{formatNumber(holding.marketValueOriginal, 2)} {holding.originalCurrency}</td>
                <td>{formatPln(holding.marketValuePln)}</td>
                <td>{holding.insight?.recommendation?.replace("_", " ") ?? "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {warnings && warnings.length ? (
        <div className="warningStack">
          {warnings.map((warning, index) => (
            <p key={`${warning}-${index}`}>{warning}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

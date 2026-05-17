export function ManualEntry({
  manualType, setManualType,
  manualDate, setManualDate,
  manualSymbol, setManualSymbol,
  manualAmount, setManualAmount,
  manualPrice, setManualPrice,
  manualComment, setManualComment,
  loading,
  onSubmit,
  onClose,
}) {
  const isCash = manualType === "Deposit" || manualType === "Withdrawal";

  return (
    <section className="manualUpdate">
      <div className="updatePanel">
        <div className="panelHead compact">
          <div>
            <span>Manual Entry</span>
            <h2>Record portfolio change</h2>
          </div>
          <button
            type="button"
            className="closeBtn"
            onClick={onClose}
            aria-label="Close manual entry"
          >×</button>
        </div>
        <div className="manualTypeSelector">
          {["Stock purchase", "Stock sale", "Dividend", "Deposit", "Withdrawal"].map((type) => (
            <button
              key={type}
              type="button"
              className={`typeBtn ${type.replace(" ", "").toLowerCase()} ${manualType === type ? "active" : ""}`}
              onClick={() => setManualType(type)}
            >
              {type}
            </button>
          ))}
        </div>
        <form className="manualForm" onSubmit={onSubmit}>
          <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />

          {!isCash ? (
            <>
              <input type="text" placeholder="Ticker (e.g. AAPL.US)" value={manualSymbol} onChange={(e) => setManualSymbol(e.target.value)} />
              <input type="number" step="0.01" placeholder="Quantity" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} required />
              <input type="number" step="0.01" placeholder="Price" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} />
              <input type="text" placeholder="Comment" value={manualComment} onChange={(e) => setManualComment(e.target.value)} />
            </>
          ) : (
            <>
              <input type="number" step="0.01" placeholder="Value (PLN)" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} required />
              <input type="text" placeholder="Comment" value={manualComment} onChange={(e) => setManualComment(e.target.value)} className="wideComment" />
            </>
          )}

          <button type="submit" disabled={loading} className="submitManualBtn">Add Record</button>
        </form>
      </div>
    </section>
  );
}

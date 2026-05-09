import { ResyncBox } from "./ResyncBox.jsx";
import { PAGES } from "../constants.js";

export function Topbar({
  data,
  page,
  navigate,
  showManualEntry,
  toggleManualEntry,
  files,
  setFiles,
  loading,
  onResync,
}) {
  return (
    <header className="topBar">
      <div>
        <span className="brandMark">XTB · Portfolio</span>
        <h1>Portfolio command center</h1>
      </div>

      {data ? (
        <div className="topActions">
          <button
            type="button"
            className={`ghostBtn ${showManualEntry ? "is-active" : ""}`}
            onClick={toggleManualEntry}
          >
            {showManualEntry ? "Cancel" : "+ Add transaction"}
          </button>
          <ResyncBox files={files} setFiles={setFiles} loading={loading} onSubmit={onResync} />
        </div>
      ) : null}

      {data ? (
        <nav className="topNav">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`topNavLink ${page === p.id ? "is-active" : ""}`}
              onClick={() => navigate(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

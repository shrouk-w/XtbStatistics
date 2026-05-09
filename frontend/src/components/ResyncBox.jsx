export function ResyncBox({ files, setFiles, loading, onSubmit }) {
  return (
    <div className="resyncBox">
      <button
        type="button"
        className="resyncSelectBtn"
        onClick={() => document.getElementById("resyncFileInput").click()}
      >
        {files.length ? `${files.length} file${files.length > 1 ? "s" : ""}` : "Choose XLSX"}
      </button>
      <input
        id="resyncFileInput"
        type="file"
        accept=".xlsx"
        multiple
        style={{ display: "none" }}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />
      <button
        type="button"
        className="resyncBtn"
        onClick={(e) => onSubmit(e, true)}
        disabled={loading || !files.length}
      >
        Re-sync
      </button>
    </div>
  );
}

import { useRef } from "react";

export function ResyncBox({ files, setFiles, loading, onSubmit }) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files ?? []);
    if (selectedFiles.length > 0) {
      setFiles(selectedFiles);
    }
  };

  return (
    <div className="resyncBox">
      <button
        type="button"
        className="resyncSelectBtn"
        onClick={() => fileInputRef.current?.click()}
      >
        {files.length ? `${files.length} file${files.length > 1 ? "s" : ""}` : "Choose XLSX"}
      </button>
      <input
        ref={fileInputRef}
        id="resyncFileInput"
        type="file"
        accept=".xlsx"
        multiple
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <button
        type="button"
        className="resyncBtn"
        onClick={(e) => onSubmit(e, true)}
        disabled={loading || !files.length}
      >
        {loading ? "Syncing..." : "Re-sync"}
      </button>
    </div>
  );
}

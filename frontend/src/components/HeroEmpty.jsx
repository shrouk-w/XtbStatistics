import { useEffect, useRef, useState } from "react";

export function HeroEmpty({ files, setFiles, loading, onSubmit }) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    function suppress(e) { e.preventDefault(); }
    window.addEventListener("dragover", suppress);
    window.addEventListener("drop", suppress);
    return () => {
      window.removeEventListener("dragover", suppress);
      window.removeEventListener("drop", suppress);
    };
  }, []);

  function onDragEnter(e) {
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }
  function onDragOver(e) { e.preventDefault(); }
  function onDragLeave(e) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }
  function onDrop(e) {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files ?? []).filter(
      (f) => f.name.toLowerCase().endsWith(".xlsx")
    );
    if (dropped.length) setFiles(dropped);
  }

  const dropzoneClass = `heroDropzone ${isDragging ? "is-dragging" : ""} ${files.length ? "has-files" : ""}`.trim();

  return (
    <section className="heroEmpty">
      <div className="heroCard">
        <div
          className={dropzoneClass}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            id="heroFileInput"
            type="file"
            accept=".xlsx"
            multiple
            style={{ display: "none" }}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <div className="heroDropzoneInner">
            <div className="heroDropIcon" aria-hidden>↓</div>
            <div className="heroDropText">
              {files.length === 0 ? (
                <>
                  <strong>Drop XTB statement</strong>
                  <span>
                    or{" "}
                    <button
                      type="button"
                      className="linkBtn"
                      onClick={() => document.getElementById("heroFileInput").click()}
                    >
                      browse
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <strong>{files.length} file{files.length > 1 ? "s" : ""} ready</strong>
                  <span>{files.map((f) => f.name).join(", ")}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <p className="heroHint">XLSX export from xStation, Reports → History.</p>

        <div className="heroActions">
          <button
            className="actionBtn sync"
            onClick={(e) => onSubmit(e, true)}
            disabled={loading || !files.length}
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>
    </section>
  );
}

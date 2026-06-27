export function ViewerToolbar({ onZoomIn, onZoomOut, pageCount, scale }) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Viewer</h2>
        <p className="text-sm text-slate-600">
          {pageCount ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}` : "Waiting for PDF"}
        </p>
      </div>

      <div className="grid grid-cols-[40px_72px_40px] items-center gap-2">
        <button
          className="h-10 rounded-md border border-slate-300 bg-white text-lg font-semibold text-slate-700 hover:bg-slate-50"
          type="button"
          aria-label="Zoom out"
          onClick={onZoomOut}
        >
          -
        </button>
        <span className="text-center text-sm font-semibold text-slate-700">{Math.round(scale * 100)}%</span>
        <button
          className="h-10 rounded-md border border-slate-300 bg-white text-lg font-semibold text-slate-700 hover:bg-slate-50"
          type="button"
          aria-label="Zoom in"
          onClick={onZoomIn}
        >
          +
        </button>
      </div>
    </div>
  );
}

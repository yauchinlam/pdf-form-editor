import { useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ViewerToolbar } from "./ViewerToolbar.jsx";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export function PdfViewer({ fileBytes, onDocumentError, onDocumentLoad, pageCount }) {
  const [scale, setScale] = useState(1);
  const documentFile = useMemo(
    () => (fileBytes ? { data: fileBytes } : null),
    [fileBytes],
  );
  const pageNumbers = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );

  if (!documentFile) {
    return (
      <section className="grid min-h-[480px] place-items-center rounded-lg border border-slate-200 bg-white">
        <div className="px-6 text-center">
          <h2 className="text-xl font-semibold text-slate-900">PDF preview will appear here</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
            The viewer uses react-pdf and a configured PDF.js worker.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <ViewerToolbar
        pageCount={pageCount}
        scale={scale}
        onZoomIn={() => setScale((current) => Math.min(current + 0.1, 1.8))}
        onZoomOut={() => setScale((current) => Math.max(current - 0.1, 0.7))}
      />

      <div className="max-h-[calc(100vh-250px)] overflow-auto bg-slate-200 px-4 py-6">
        <Document
          className="grid justify-items-center gap-6"
          file={documentFile}
          loading={<ViewerMessage message="Rendering PDF..." />}
          error={<ViewerMessage message="Unable to render this PDF." tone="error" />}
          onLoadSuccess={onDocumentLoad}
          onLoadError={onDocumentError}
        >
          {pageNumbers.map((pageNumber) => (
            <div key={pageNumber} className="overflow-hidden rounded-md bg-white shadow-lg">
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderAnnotationLayer
                renderForms
                renderTextLayer
                loading={<ViewerMessage message={`Loading page ${pageNumber}...`} />}
              />
            </div>
          ))}
        </Document>
      </div>
    </section>
  );
}

function ViewerMessage({ message, tone = "neutral" }) {
  return (
    <div className={tone === "error" ? "p-6 text-sm text-red-700" : "p-6 text-sm text-slate-600"}>
      {message}
    </div>
  );
}

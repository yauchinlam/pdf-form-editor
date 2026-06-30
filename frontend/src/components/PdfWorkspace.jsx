import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  AlertCircle,
  CalendarDays,
  CheckSquare,
  FileUp,
  Loader2,
  PenLine,
  Type,
  X,
} from "lucide-react";
import {
  FIELD_TYPES,
  formatFieldType,
  normalizeDetectedField,
  tableCellPlaceholder,
} from "../lib/fillableFieldGenerator.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/analyze-pdf";
const ANALYSIS_TIMEOUT_MS = 90_000;
const HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_URL = API_URL.replace(/\/api\/analyze-pdf\/?$/, "/api/health");

export function PdfWorkspace() {
  const fileInputRef = useRef(null);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [detectedFields, setDetectedFields] = useState([]);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState("Choose a flat PDF to analyze its visible field layout.");
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeMenu, setActiveMenu] = useState(null);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const fieldsByPage = useMemo(() => {
    return detectedFields.reduce((groups, field) => {
      const pageNumber = Number(field.page_number) || 1;
      if (!groups.has(pageNumber)) groups.set(pageNumber, []);
      groups.get(pageNumber).push(field);
      return groups;
    }, new Map());
  }, [detectedFields]);

  const pageNumbers = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );

  const analyzeFile = useCallback(
    async (file) => {
      if (!file) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please select a valid PDF file.");
        return;
      }

      setError("");
      setStatus(`Analyzing ${file.name}...`);
      setIsAnalyzing(true);
      setDetectedFields([]);
      setPageCount(0);
      setActiveMenu(null);
      setPdfFile(null);

      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl("");

      const formData = new FormData();
      formData.append("file", file);

      setStatus("Checking analysis API...");

      try {
        await verifyApiHealth();

        setStatus(`Analyzing ${file.name}...`);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

        const response = await fetch(API_URL, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);

        let payload = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        if (!response.ok) {
          const message = payload?.detail || "The PDF could not be analyzed.";
          throw new Error(message);
        }

        if (!Array.isArray(payload)) {
          throw new Error("The analysis service returned an unexpected response.");
        }

        setPdfFile(file);
        setPdfUrl(URL.createObjectURL(file));
        setDetectedFields(payload.map(normalizeDetectedField));
        setStatus(`Detected ${payload.length} structural ${payload.length === 1 ? "field" : "fields"}.`);
      } catch (analysisError) {
        setDetectedFields([]);
        const message = analysisError instanceof Error ? analysisError.message : "The PDF could not be analyzed.";
        setError(
          analysisError instanceof DOMException && analysisError.name === "AbortError"
            ? "Analysis timed out after 90 seconds. The backend may still be starting up or the PDF may be too complex."
            : message === "Failed to fetch"
              ? "Upload failed because the analysis API could not be reached. Check the deployed backend URL and CORS settings."
              : message,
        );
        setStatus("Analysis failed.");
      } finally {
        setIsAnalyzing(false);
      }
    },
    [pdfUrl],
  );
  const updateField = useCallback((fieldId, updates) => {
    setDetectedFields((currentFields) =>
      currentFields.map((field) => (field.field_id === fieldId ? { ...field, ...updates } : field)),
    );
  }, []);

  const closeMenu = useCallback(() => setActiveMenu(null), []);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950" onClick={closeMenu}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">PDF Layout Workspace</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{error || status}</p>
          </div>

          <button
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={isAnalyzing}
            onClick={() => fileInputRef.current?.click()}
          >
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            {isAnalyzing ? "Analyzing..." : "Upload PDF"}
          </button>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="application/pdf"
            onChange={(event) => analyzeFile(event.target.files?.[0])}
          />
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[280px_1fr]">
        <aside className="h-fit rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CheckSquare className="h-4 w-4 text-blue-600" />
            Detected fields
          </div>
          <div className="mt-3 text-sm text-slate-600">
            {pdfFile?.name || "No PDF selected"}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Metric label="Pages" value={pageCount} />
            <Metric label="Fields" value={detectedFields.length} />
          </div>
          {error ? (
            <div className="mt-4 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="mt-5 max-h-[42vh] space-y-2 overflow-auto pr-1">
            {detectedFields.map((field) => (
              <button
                key={field.field_id}
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm transition hover:border-blue-300 hover:bg-blue-50"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveMenu({
                    fieldId: field.field_id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                <span className="flex items-center gap-2 font-medium text-slate-900">
                  <FieldIcon type={field.type} />
                  {formatFieldType(field)}
                </span>
                <span className="mt-1 block truncate text-xs text-slate-500">
                  {field.type === "table_cell"
                    ? `Row ${field.row_index + 1}, column ${field.column_index + 1}`
                    : field.label_context || "No OCR label"}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-h-[620px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {!pdfUrl ? (
            <UploadTarget disabled={isAnalyzing} onFile={analyzeFile} />
          ) : (
            <div className="max-h-[calc(100vh-170px)] overflow-auto bg-slate-200 px-4 py-5">
              <Document
                className="grid justify-items-center gap-6"
                file={pdfUrl}
                loading={<WorkspaceMessage message="Rendering PDF..." />}
                error={<WorkspaceMessage tone="error" message="Unable to render this PDF." />}
                onLoadSuccess={({ numPages }) => setPageCount(numPages)}
                onLoadError={() => setError("This file could not be opened as a PDF.")}
              >
                {pageNumbers.map((pageNumber) => (
                  <PdfPageWithOverlay
                    key={pageNumber}
                    fields={fieldsByPage.get(pageNumber) || []}
                    pageNumber={pageNumber}
                    onContextMenu={(fieldId, event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setActiveMenu({ fieldId, x: event.clientX, y: event.clientY });
                    }}
                  />
                ))}
              </Document>
            </div>
          )}
        </section>
      </main>

      {activeMenu ? (
        <FieldCorrectionMenu
          field={detectedFields.find((field) => field.field_id === activeMenu.fieldId)}
          position={activeMenu}
          onUpdate={updateField}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}

async function verifyApiHealth() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(HEALTH_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Analysis API health check failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (payload?.status !== "ok") {
      throw new Error("Analysis API health check returned an unexpected response.");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Analysis API health check timed out after 15 seconds.");
    }

    if (error instanceof TypeError) {
      throw new Error("Analysis API health check failed. The backend may be unreachable or blocked by CORS.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function UploadTarget({ disabled, onFile }) {
  const [isDragging, setIsDragging] = useState(false);

  function acceptDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    onFile(event.dataTransfer.files?.[0]);
  }

  return (
    <div
      className={[
        "grid min-h-[620px] place-items-center border-2 border-dashed px-6 text-center transition",
        isDragging ? "border-blue-500 bg-blue-50" : "border-transparent bg-white",
        disabled ? "opacity-60" : "",
      ].join(" ")}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragging(false);
      }}
      onDrop={acceptDrop}
    >
      <div>
        <FileUp className="mx-auto h-10 w-10 text-blue-600" />
        <h2 className="mt-4 text-xl font-semibold text-slate-900">Drop a flat PDF here</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
          The backend will rasterize the pages, detect lines and boxes, then map each field to nearby OCR text.
        </p>
      </div>
    </div>
  );
}

function PdfPageWithOverlay({ fields, onContextMenu, pageNumber }) {
  return (
    <div className="relative overflow-hidden rounded-md bg-white shadow-lg">
      <Page
        pageNumber={pageNumber}
        renderAnnotationLayer={false}
        renderTextLayer
        loading={<WorkspaceMessage message={`Loading page ${pageNumber}...`} />}
      />
      <div className="absolute inset-0">
        {fields.map((field) => (
          <FieldOverlay
            key={field.field_id}
            field={field}
            onContextMenu={(event) => onContextMenu(field.field_id, event)}
          />
        ))}
      </div>
    </div>
  );
}

function FieldOverlay({ field, onContextMenu }) {
  const geometry = field.geometry;
  const style = {
    left: `${geometry.x * 100}%`,
    top: `${geometry.y * 100}%`,
    width: `${geometry.width * 100}%`,
    height: `${geometry.height * 100}%`,
  };

  return (
    <div
      className={[
        "absolute z-10 min-h-4 min-w-4 rounded-[3px] shadow-[0_0_0_1px_rgba(255,255,255,0.85)]",
        field.type === "table_cell" ? "border border-emerald-500 bg-emerald-500/5" : "border border-blue-500 bg-blue-500/10",
      ].join(" ")}
      style={style}
      title={`${formatFieldType(field)}: ${field.label_context || "No OCR label"}`}
      onContextMenu={onContextMenu}
    >
      {renderFieldControl(field)}
    </div>
  );
}

function renderFieldControl(field) {
  const baseClass = "h-full w-full border-0 bg-white/70 text-[10px] text-slate-950 outline-none";

  if (field.type === "table_cell") {
    return <TableCellControl field={field} />;
  }

  if (field.type === "checkbox") {
    return (
      <label className="grid h-full w-full place-items-center">
        <input className="h-full w-full accent-blue-600" type="checkbox" aria-label={field.label_context || field.field_id} />
      </label>
    );
  }

  if (field.type === "date") {
    return (
      <div className="flex h-full w-full items-center gap-1 bg-white/80 px-1 text-[10px] text-slate-700">
        <CalendarDays className="h-3 w-3 shrink-0 text-blue-700" />
        <span className="truncate">MM/DD/YYYY</span>
      </div>
    );
  }

  if (field.type === "signature") {
    return (
      <input
        className={`${baseClass} font-['Caveat'] text-sm`}
        aria-label={field.label_context || field.field_id}
        placeholder="Sign"
      />
    );
  }

  return <input className={baseClass} type="text" aria-label={field.label_context || field.field_id} />;
}

function TableCellControl({ field }) {
  if (field.selection_tokens.length > 0) {
    return (
      <div className="relative h-full w-full">
        {field.selection_tokens.map((token, index) => (
          <label
            key={`${token.value}-${index}`}
            className="absolute grid aspect-square place-items-center rounded-[2px] bg-white/70"
            style={{
              left: `${token.geometry.x * 100}%`,
              top: `${token.geometry.y * 100}%`,
              width: `${token.geometry.width * 100}%`,
              height: `${token.geometry.height * 100}%`,
            }}
            title={token.value}
          >
            <input
              className="h-full w-full accent-emerald-600"
              type="checkbox"
              aria-label={`${field.label_context || field.field_id} ${token.value}`}
            />
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <input
        className="absolute bottom-0 left-0 h-[70%] w-full border-0 bg-white/75 px-1 text-[10px] text-slate-950 outline-none"
        type="text"
        aria-label={field.label_context || field.field_id}
        placeholder={tableCellPlaceholder(field)}
      />
    </div>
  );
}

function FieldCorrectionMenu({ field, onClose, onUpdate, position }) {
  if (!field) return null;

  const left = Math.min(position.x, window.innerWidth - 280);
  const top = Math.min(position.y, window.innerHeight - 180);

  return (
    <div
      className="fixed z-50 w-64 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-xl"
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-slate-900">
          <FieldIcon type={field.type} />
          Correct field
        </div>
        <button
          className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          type="button"
          onClick={onClose}
          aria-label="Close correction menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <label className="block text-xs font-medium text-slate-600" htmlFor={`${field.field_id}-type`}>
        Field type
      </label>
      <select
        id={`${field.field_id}-type`}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-blue-500"
        value={field.type}
        onChange={(event) => onUpdate(field.field_id, { type: event.target.value })}
      >
        {FIELD_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      <label className="mt-3 block text-xs font-medium text-slate-600" htmlFor={`${field.field_id}-label`}>
        Label context
      </label>
      <input
        id={`${field.field_id}-label`}
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm outline-none focus:border-blue-500"
        value={field.label_context}
        onChange={(event) => onUpdate(field.field_id, { label_context: event.target.value })}
      />
    </div>
  );
}

function FieldIcon({ type }) {
  if (type === "table_cell") return <CheckSquare className="h-4 w-4 text-emerald-600" />;
  if (type === "checkbox") return <CheckSquare className="h-4 w-4 text-blue-600" />;
  if (type === "date") return <CalendarDays className="h-4 w-4 text-blue-600" />;
  if (type === "signature") return <PenLine className="h-4 w-4 text-blue-600" />;
  return <Type className="h-4 w-4 text-blue-600" />;
}

function Metric({ label, value }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function WorkspaceMessage({ message, tone = "neutral" }) {
  return (
    <div className={tone === "error" ? "p-6 text-sm text-red-700" : "p-6 text-sm text-slate-600"}>
      {message}
    </div>
  );
}

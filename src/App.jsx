import { useCallback, useMemo, useState } from "react";
import { FileDropZone } from "./components/FileDropZone.jsx";
import { GenerationSummary } from "./components/GenerationSummary.jsx";
import { PdfViewer } from "./components/PdfViewer.jsx";
import { Shell } from "./components/Shell.jsx";
import { SignatureInput } from "./components/SignatureInput.jsx";
import { generateFillableFields } from "./lib/fillableFieldGenerator.js";

const initialStatus = "Upload a PDF to preview it.";

export default function App() {
  const [pdfFile, setPdfFile] = useState(null);
  const [sourceBuffer, setSourceBuffer] = useState(null);
  const [viewerBytes, setViewerBytes] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [statusMessage, setStatusMessage] = useState(initialStatus);
  const [pageCount, setPageCount] = useState(0);
  const [generatedFields, setGeneratedFields] = useState([]);
  const [, setSignatureName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const viewerStatus = useMemo(() => {
    if (loadError) return loadError;
    if (pdfFile && pageCount > 0) {
      return `${pdfFile.name} loaded with ${pageCount} ${pageCount === 1 ? "page" : "pages"}. ${generatedFields.length ? `${generatedFields.length} fillable fields generated.` : "Ready to generate fields."}`;
    }
    return statusMessage;
  }, [generatedFields.length, loadError, pageCount, pdfFile, statusMessage]);

  const handleFileAccepted = useCallback(async (file) => {
    setLoadError("");
    setPageCount(0);
    setGeneratedFields([]);
    setPdfFile(file);
    setSourceBuffer(null);
    setViewerBytes(null);
    setIsProcessing(true);
    setStatusMessage(`Loading ${file.name}...`);

    try {
      const buffer = await file.arrayBuffer();
      setSourceBuffer(buffer);
      setViewerBytes(cloneBufferForViewer(buffer));
      setStatusMessage("PDF loaded. Click Generate Fillable Fields to add form fields to page 1.");
    } catch (error) {
      console.error(error);
      setPdfFile(null);
      setLoadError("This file could not be read. Try another PDF.");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleInvalidFile = useCallback((message) => {
    setPdfFile(null);
    setSourceBuffer(null);
    setViewerBytes(null);
    setPageCount(0);
    setGeneratedFields([]);
    setLoadError(message);
  }, []);

  const handleGenerateFields = useCallback(async () => {
    if (!sourceBuffer) return;

    setIsProcessing(true);
    setLoadError("");
    setStatusMessage("Generating fillable fields on page 1...");

    try {
      const { generatedBytes, generatedFields, mode } = await generateFillableFields(sourceBuffer);
      setViewerBytes(cloneBufferForViewer(generatedBytes));
      setGeneratedFields(generatedFields);
      setStatusMessage(
        mode === "acroform"
          ? "Native AcroForm fields detected. Showing existing interactive fields without generating overlays."
          : "Generated calibrated fillable fields for the flat PDF.",
      );
    } catch (error) {
      console.error(error);
      setLoadError(error instanceof Error ? error.message : "Could not generate fillable fields for this PDF.");
    } finally {
      setIsProcessing(false);
    }
  }, [sourceBuffer]);

  const handleDocumentLoad = useCallback(({ numPages }) => {
    setPageCount(numPages);
    setLoadError("");
  }, []);

  const handleDocumentError = useCallback(() => {
    setPageCount(0);
    setLoadError("This file could not be opened as a PDF. Try another file.");
  }, []);

  return (
    <Shell
      status={viewerStatus}
      fileName={pdfFile?.name}
      action={
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={!sourceBuffer || isProcessing}
          onClick={handleGenerateFields}
        >
          {isProcessing ? "Working..." : "Generate Fillable Fields"}
        </button>
      }
    >
      <div className="grid min-h-full grid-rows-[auto_1fr]">
        <FileDropZone
          disabled={isProcessing}
          hasFile={Boolean(pdfFile)}
          onFileAccepted={handleFileAccepted}
          onInvalidFile={handleInvalidFile}
        />

        <GenerationSummary generatedFields={generatedFields} />

        <SignatureInput onSignatureChange={setSignatureName} />

        <PdfViewer
          fileBytes={viewerBytes}
          pageCount={pageCount}
          onDocumentLoad={handleDocumentLoad}
          onDocumentError={handleDocumentError}
        />
      </div>
    </Shell>
  );
}

function cloneBufferForViewer(bytes) {
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes.slice(0));
  }

  return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

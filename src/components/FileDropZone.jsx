import { useRef, useState } from "react";

export function FileDropZone({ disabled, hasFile, onFileAccepted, onInvalidFile }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  function validateAndAccept(file) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onInvalidFile("Please choose a valid PDF file.");
      return;
    }
    onFileAccepted(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    validateAndAccept(event.dataTransfer.files?.[0]);
  }

  return (
    <section className="mb-6">
      <div
        className={[
          "flex min-h-44 flex-col items-center justify-center rounded-lg border-2 border-dashed bg-white px-6 py-8 text-center transition",
          isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300",
          disabled ? "opacity-60" : "hover:border-blue-400",
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
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="application/pdf"
          disabled={disabled}
          onChange={(event) => validateAndAccept(event.target.files?.[0])}
        />
        <p className="text-lg font-semibold text-slate-900">{hasFile ? "Load a different PDF" : "Drop a PDF here"}</p>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
          Choose a local PDF, then generate new clickable form fields on page 1.
        </p>
        <button
          className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {disabled ? "Processing..." : "Select PDF"}
        </button>
      </div>
    </section>
  );
}

export function GenerationSummary({ generatedFields }) {
  if (!generatedFields.length) return null;
  const isNativeAcroForm = generatedFields.some((field) => field.mode === "acroform");

  return (
    <section className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-4">
      <h2 className="text-sm font-semibold text-blue-950">
        {isNativeAcroForm ? "Native AcroForm Fields" : "Generated Fillable Fields"}
      </h2>
      <p className="mt-1 text-sm text-blue-800">
        {isNativeAcroForm
          ? `Detected ${generatedFields.length} existing interactive fields.`
          : `Added ${generatedFields.length} aligned interactive fields to page 1.`}
      </p>

      <div className="mt-4 grid gap-2">
        {generatedFields.map((field) => (
          <div
            key={field.name}
            className="grid gap-1 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto_auto] sm:items-center"
          >
            <span className="font-medium text-slate-900">{field.label}</span>
            <span className="text-slate-600">{field.kind || "text"}</span>
            {isNativeAcroForm ? (
              <span className="text-blue-700 sm:col-span-2">native PDF field</span>
            ) : (
              <>
                <span className="text-slate-600">
                  {field.width} x {field.height}
                </span>
                <span className="text-blue-700">
                  x {field.x}, y {field.y}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

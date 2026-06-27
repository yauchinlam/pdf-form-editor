export function Shell({ action, children, fileName, status }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">PDF Form Editor</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{status}</p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            {action}
            <div className="min-h-10 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {fileName || "No PDF selected"}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto min-h-[calc(100vh-97px)] max-w-7xl px-5 py-6">{children}</main>
    </div>
  );
}

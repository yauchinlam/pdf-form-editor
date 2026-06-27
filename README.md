# PDF Form Editor

Phase 2 React application for previewing uploaded PDFs and generating new fillable fields on a flat PDF. This setup uses React 19, Tailwind CSS, `react-pdf`, and `pdf-lib`.

## Run

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

## Current Scope

- React 19 functional components.
- Tailwind CSS layout and controls.
- Modular file upload drop-zone and viewer components.
- `react-pdf` rendering with annotation and text layers enabled.
- Graceful invalid/corrupt file error states.
- A header action button generates new fillable fields on page 1.
- `pdf-lib` opens the raw uploaded PDF bytes, accesses the AcroForm layer with `pdfDoc.getForm()`, creates text fields, and writes the modified bytes back into the viewer.
- Demo fields are generated for Name, Date, and Signature.

Interactive field editing and final download are intentionally left for later stop points.

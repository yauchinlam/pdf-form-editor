# PDF Form Editor

React and FastAPI workspace for analyzing flat PDFs, detecting visible form fields and vector table grids, and overlaying editable controls on top of rendered PDF pages.

## Project Layout

```text
backend/
  app/main.py              FastAPI API for PDF layout analysis
  requirements.txt         Python backend dependencies
frontend/
  src/main.jsx             React entrypoint
  src/styles.css           Tailwind and react-pdf styling
  src/components/          Workspace UI
index.html                 Vite HTML entrypoint
```

The old root `src/` React app has been removed. Vite now loads `frontend/src/main.jsx`.

## System Requirements

The backend uses Poppler for PDF rasterization and Tesseract for OCR. Install both before running the API.

macOS:

```bash
brew install poppler tesseract
```

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install poppler-utils tesseract-ocr
```

If apt reports `404 Not Found` for `jammy-updates` packages, the local package index is stale. Refresh it and retry:

```bash
sudo apt-get clean
sudo apt-get update
sudo apt-get install poppler-utils tesseract-ocr
```

## Frontend Setup

```bash
npm install
npm run dev
```

Open the app at:

```text
http://localhost:5173
```

## Backend Setup

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```text
http://localhost:8000/api/health
```

The frontend posts PDFs to:

```text
http://localhost:8000/api/analyze-pdf
```

## Backend Deployment

The backend can be deployed to Render as a Docker web service. The included
`backend/Dockerfile` installs the Python dependencies plus Poppler and
Tesseract, then starts FastAPI with Render's `PORT` environment variable.

Render setup:

```text
Service type: Web Service
Environment: Docker
Dockerfile path: ./backend/Dockerfile
Docker build context: .
Health check path: /api/health
```

The repo also includes `render.yaml` for Render Blueprint deploys.

After Render creates the backend service, set this GitHub Actions repository
variable for the GitHub Pages frontend:

```text
VITE_API_URL=https://YOUR_RENDER_SERVICE.onrender.com/api/analyze-pdf
```

If the frontend is hosted from another domain, set the backend environment
variable `FRONTEND_ORIGINS` to a comma-separated list of allowed origins.

## Development

Run both services at the same time:

```bash
# terminal 1
. .venv/bin/activate
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload

# terminal 2
npm run dev
```

Upload a flat PDF in the browser. The API first parses vector table grids with `pdfplumber` and returns each grid cell as a normalized `table_cell` boundary. It then rasterizes the document at 150 DPI, detects non-table write-in lines and checkbox-like boxes with OpenCV, maps nearby OCR labels with Tesseract when available, and returns normalized field geometry for the React overlay.

Table-cell overlays bypass the older text-subtraction behavior. Alphanumeric cells use the lower 70% of the cell as the input target, while cells containing M/F selection tokens receive small 1:1 checkbox hit targets positioned over the detected glyphs.

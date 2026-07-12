# ORC Document Automation

A local-first document automation MVP built with React, Node.js/Express, SQLite, local file storage, and open-source PDF tooling.

## What Works

- Register/login with admin/client roles
- Upload a PDF template to local storage
- Run local PDF text/layout detection for likely fields
- View the PDF in a React editor
- Add, drag, resize, rename, require, and delete fields
- Save template fields once and reuse them
- Generate a custom data-entry form from saved fields
- Fill the uploaded PDF using submitted form data
- Preview highlighted fields and download generated PDFs
- Upload CSV/XLSX spreadsheets, map columns to fields, and bulk generate PDFs
- Generate PDFs through `POST /api/templates/:id/generate/api`
- Store originals and generated files in separate local folders

The detection step uses local PDF text/layout extraction through `pdfjs-dist`. No AWS Textract, Azure Document Intelligence, Google Vision, OpenAI API, paid OCR, or external OCR service is used.

## Tech Stack

- Frontend: React, Vite, pdfjs-dist, lucide-react
- Backend: Node.js, Express, Multer
- Database: SQLite through better-sqlite3
- PDF generation: pdf-lib
- Spreadsheet parsing: xlsx
- Storage:
  - Original PDFs: `server/uploads/originals`
  - Generated PDFs: `server/uploads/generated`
  - Temporary spreadsheets: `server/uploads/spreadsheets`
  - SQLite database: `server/data/app.db`

## Setup

```bash
cp .env.example .env
npm install
npm run seed
npm run dev
```

Then open:

```text
http://localhost:5173
```

Demo login after seeding:

```text
Email: demo@example.com
Password: password123
```

The Express API runs on `http://localhost:4000`. Vite proxies `/api` to the backend during development.

## Production-Style Local Run

```bash
npm run build
npm start
```

Then open:

```text
http://localhost:4000
```

## API Routes

```text
POST   /api/auth/register
POST   /api/auth/login
GET    /api/dashboard
POST   /api/templates/upload
GET    /api/templates
GET    /api/templates/:id
GET    /api/templates/:id/pdf
POST   /api/templates/:id/fields
PUT    /api/templates/:id/fields/:fieldId
DELETE /api/templates/:id/fields/:fieldId
POST   /api/templates/:id/generate/form
POST   /api/templates/:id/spreadsheet/preview
POST   /api/templates/:id/generate/spreadsheet
POST   /api/templates/:id/api-key
POST   /api/templates/:id/generate/api
GET    /api/documents
GET    /api/documents/:id
GET    /api/documents/:id/download
```

Most routes require a JWT bearer token from login. The API generation route also accepts an `x-api-key` created for that template.

Example API generation request:

```bash
curl -X POST http://localhost:4000/api/templates/1/generate/api \
  -H "Content-Type: application/json" \
  -H "x-api-key: orc_live_your_key_here" \
  -d '{"client_name":"Taylor Morgan","email":"taylor@example.com","approved":true}'
```

## Database Tables

- `users`
- `document_templates`
- `template_fields`
- `field_mappings`
- `generated_documents`
- `api_keys`

## Notes

- Field coordinates are stored in PDF points with a top-left origin in the editor. The backend converts them for `pdf-lib`, which uses a bottom-left origin.
- Scanned-image PDFs will need a local OCR renderer/Tesseract enhancement for stronger automatic detection. The MVP still supports manual field setup for any PDF that renders in the browser.
- Uploaded and generated documents are never placed in public static folders. They are streamed through authenticated API routes.

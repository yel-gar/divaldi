---
name: frontend-file-preview
description: Conventions for the inline file preview in the divaldi frontend — PDF, image, docx and xlsx rendering, lazy loading of docx-preview/xlsx/hyperformula, HyperFormula cross-sheet evaluation, and the upload polling handshake. Use when touching file-preview or attachment upload code.
---

# File preview and attachment upload — divaldi conventions

Covers `file-preview.component.ts`, the results panel, and `AttachmentUploadService`.

## Supported formats

| Type | Preview path |
|---|---|
| PDF | object/iframe embed of the presigned S3 URL |
| PNG, JPEG | `<img>` against the presigned S3 URL |
| DOCX | `docx-preview`, lazily imported |
| XLSX | `xlsx` (SheetJS) parsed and rendered as a sheet grid |

Backend-side accepted upload types: `.pdf`, `.dxf`, `.png`, `.jpeg`, `.jpg`, up to
**30 MB**, at most **3 concurrent uploads** (`MAX_FILE_SIZE`, `ACCEPTED_EXTENSIONS`,
`MAX_CONCURRENT_UPLOADS` in `core/models/models.ts`). DXF is parsed server-side and never
previewed as a document.

## Heavy dependencies must stay lazy

```typescript
const { renderAsync } = await import('docx-preview');
const XLSX = await import('xlsx');
const { HyperFormula } = await import('hyperformula');
```

Promoting any of these to a static top-level import pulls it into the eager bundle for every
user, including those who never open a preview. Keep the dynamic `import()`.

## XLSX previews need a formula engine

The generated commercial offer (`kp.xlsx`) prices rows using **workbook formulas**, not
literal values. Rendering cells without evaluating formulas shows blanks where prices should
be. HyperFormula is configured to evaluate across sheets, because the offer spreads metal
prices on the `Цены на металл` sheet and references them from `Расчёт`.

When changing the renderer, verify a price cell on `Расчёт` actually displays a number, not
an empty cell or a raw formula string.

## Sheet tabs and the active pill

XLSX previews show one tab per sheet with a sliding active-pill indicator. The pill position
is animated, and the indicator must stay correct when a sheet is switched and when the
preview is re-rendered for a different file. `first_position`-style selection state is per
preview instance, not global.

## Download versus preview

Previews read from a **presigned S3 URL** returned by the backend. The download action
uses a separate presigned URL. Both expire, so a URL held in component state can go stale;
re-fetch rather than caching a long-lived URL.

## Upload handshake and polling

Upload is a two-step flow: the backend issues presigned S3 upload parameters, the browser
uploads directly to object storage, then the client confirms. Status is polled rather than pushed:

```typescript
const STATUS_POLL_INTERVAL_MS = 2000;
const STATUS_POLL_LIMIT = 150;
```

`AttachmentUploadService` polls upload status on that interval up to that limit, then gives
up. Keep these constants; they bound the request storm and the user-visible wait.

Server-side, `process_attachment` and `process_pdf` run on the `default` TaskIQ queue and
write progress keys that this polling reads. Progress values are `completed` and `error`.

## Result polling

Generation results are polled separately in the chat component:

```typescript
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
```

A 5-minute timeout followed by a visible state is intentional. Do not extend it silently to
hide a stuck worker.

## Gotchas

- Failure is a **normal, expected state** in this UI, not an exception. Every preview path
  needs a visible error state alongside the skeleton and empty states.
- Delete a session while a result is in flight and the backend discards the result via a
  tombstone key; the frontend may still receive one poll response before that happens, so
  guard against updating destroyed state.
- Markdown rendering in chat uses `marked` plus `marked-highlight` and `highlight.js`, and is
  unrelated to file previews even though both live in the chat view.

## Verify

```bash
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build

# end-to-end check needs the real stack, since previews read from S3
docker compose up -d --build
```

Then exercise: upload a PDF, a DXF, a PNG, a generated `kp.xlsx`, download it, reopen the
preview, and switch between its sheets.

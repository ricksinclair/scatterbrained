# Viewers — read everything in place

Provenance is only useful if you can follow it without leaving. Every file
type the graph can point at opens **inside the workspace**, themed like the
rest of the app, with notes attachable right where you're reading. All reads
go through the [document-roots sandbox](document-roots.md).

## What opens in place

- **Markdown** — a full doc renderer (tables, fenced code with syntax
  highlighting, nested lists, live PlantUML diagrams), plus an **editor**:
  edit and save back to disk, with the save committed to git so every change
  is recoverable. Ingested doc sets get the full [Docs lens](../overview.md)
  treatment — the very site you're reading.
- **Spreadsheets (CSV/XLSX)** — a sheet viewer with a row-number gutter;
  notes attach per cell, whole row, or whole column. Ask the assistant for a
  chart over the data and save it as a live lens.
- **PDF** — rendered in-app (vendored renderer, no plugin), page-anchored
  notes.
- **Word & PowerPoint** — text extraction and in-place reading for `.docx`
  and `.pptx` sources.
- **Diagrams** — PlantUML sources render through a **local** binary in a
  restricted process (never a web service) and re-color live when you switch
  themes — a stored diagram never needs re-rendering to match the app.
- **Code** — syntax-highlighted, read-only (or frozen at a commit inside a
  [review](code-lens.md)), with line-anchored comments.

## The rules all viewers share

1. **Read live, store nothing** — file bodies are read from disk on open,
   size-capped, never copied into the graph. The graph holds the pointer and
   the provenance.
2. **One anchor model** — every viewer's notes are the same
   (kind, locator, snippet) shape, so the *Needs review* queue and the
   inspector treat them uniformly.
3. **Theme-native** — the same design tokens drive text, tables, code
   highlighting, charts, and diagrams. Nothing looks pasted in.
4. **Sandboxed** — a file outside your granted roots shows a lock and a
   one-click grant on-ramp, never a silent failure and never a bypass.

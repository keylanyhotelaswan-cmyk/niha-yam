# Print Designer UX — Improvement Note

**Date:** 2026-07-13  
**Type:** UX only (Printing freeze exception: simple UX)  
**Scope:** Print Center → تخطيط الورقة  

## What changed

- Main screen: **document elements** + **live preview** + **إضافة عنصر** only.
- Add flow: group catalog → dialog of fields → Add.
- Settings: per-field dialog (label, label mode, font, bold, align, spacing, value format).
- Reorder: drag sections on the document list (`section_order` — same print order).
- Extensibility: `registerPrintDesignerGroup()` in `designer-catalog.ts` for future modules.

## Unchanged

Bridge · Queue · Payload · Snapshot · Render rules · WYSIWYG.

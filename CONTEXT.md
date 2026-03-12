# IMF Context / Breadcrumbs

This file captures practical findings from real-world testing so future updates keep behavior consistent.

## Core Principle
- Prefer EXIF from the uploaded source file.
- Do not silently invent metadata when EXIF exists.
- Fallback labels should only be used when EXIF is truly missing (or explicitly user-selected).

## Key Findings (from testing)

### 1) Telegram JPGs often strip EXIF
- Many Telegram-delivered JPGs had `exif_count = 0`.
- In those files, Make/Model/Focal/ISO are unavailable.
- Result: UI should clearly indicate EXIF-missing state and avoid presenting guessed values as factual.

### 2) HEIC from iOS/iPad retains rich EXIF
- HEIC docs/files preserve metadata reliably.
- Parsing required switching from `exifr/lite` to `exifr/full` for better HEIC coverage.

### 3) iOS focal length semantics
- Apple Photos prominently shows 35mm-equivalent focal length (e.g., 28mm), not physical lens focal (e.g., ~3mm).
- IMF now prefers `FocalLengthIn35mm...` for Apple devices to match user expectations and iOS UI.

### 4) Footer overlap issues were layout-bound, not random
- Overlap occurred on certain aspect ratios/resolutions with long camera/date strings.
- Fixed via measured 3-column layout with bounded widths + ellipsis truncation.

### 5) Reframing already-framed images causes artifacts
- Existing white metadata footer can stack/overlap if reprocessed.
- Added pre-pass to detect and strip prior footer when possible.

### 6) Tiny image guard
- Some uploads are tiny previews/thumbnails (e.g., ~120x248).
- These should be rejected with a clear message; they are not suitable source files.

## Current Behavior Expectations
- JPEG/PNG/WEBP: parse EXIF if present.
- HEIC/HEIF: parse via full EXIF parser + browser decode path.
- RAW formats (NEF/CR2/CR3/ARW/DNG/RAF/ORF/RW2/PEF/SRW/GPR/3FR): best-effort via embedded thumbnail in browser; may fail depending on file.
- ISO extraction reads multiple tag variants (`ISOSpeedRatings`, `PhotographicSensitivity`, etc.).

## Verification Tip
When debugging a report:
1. Check if EXIF exists at all (`exif_count > 0`).
2. Check Make/Model, focal tags, and ISO tags in parsed output.
3. If EXIF is missing, confirm source delivery method (compressed social export vs original file/document).

## Recent iPad Validation Case
- Uploaded iPad HEIC file parsed as:
  - Make: Apple
  - Model: iPad Pro 11-inch (M4)
  - Aperture: f/1.8
  - Shutter: 1/65s
  - ISO: 64
  - Focal displayed as 28mm (35mm-equivalent)
- This aligns with Apple Photos display behavior.

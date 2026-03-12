# IMF — Image Metadata Framer

Client-side web app that adds a camera-metadata footer to photos.

## Features
- Local processing only (no backend upload)
- EXIF parsing in-browser
- HEIC/HEIF decode in-browser
- RAW format support (NEF, NRW, CR2, CR3, CRW, ARW, DNG, RAF, ORF, RW2, PEF, SRW, GPR, 3FR, FFF, RWL)
- Vendor logo mapping (Apple / Nikon / Canon / Sony / Fujifilm / Olympus / Pentax / Hasselblad / and more)
- Batch processing + download-all

## Run locally
Because this uses ES modules and CDN imports, serve over HTTP:

```bash
cd imf
python -m http.server 8099
```

Then open:
- http://localhost:8099

## Notes
- For Telegram media: send as **file/document** to preserve EXIF.
- Compressed image uploads may strip EXIF and show Unknown Camera.

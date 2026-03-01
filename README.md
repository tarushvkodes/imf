# IMF — Image Metadata Framer

Client-side web app that adds a camera-metadata footer to photos.

## Features
- Local processing only (no backend upload)
- EXIF parsing in-browser
- HEIC/HEIF decode in-browser
- Vendor logo mapping (Apple / Nikon / Unknown)
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

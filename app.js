import exifr from 'https://cdn.jsdelivr.net/npm/exifr/dist/full.esm.js';
import heic2any from 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm';

const BRAND_LOGO_PATHS = {
  apple: './assets/apple.svg',
  nikon: './assets/nikon.svg',
  canon: './assets/canon.svg',
  sony: './assets/sony.svg',
  fujifilm: './assets/fujifilm.svg',
  samsung: './assets/samsung.svg',
  google: './assets/google.svg',
  dji: './assets/dji.svg',
  gopro: './assets/gopro.svg',
  panasonic: './assets/panasonic.svg',
  leica: './assets/leica.svg',
  unknown: './assets/camera.svg',
};

const logos = await loadLogos();

const $ = (id) => document.getElementById(id);
const input = $('fileInput');
const dropZone = $('dropZone');
const statusEl = $('status');
const progressBarEl = $('progressBar');
const resultsEl = $('results');
const processBtn = $('processBtn');
const downloadAllBtn = $('downloadAllBtn');

let files = [];
let outputs = [];

$('pickBtn').onclick = () => input.click();
input.onchange = (e) => setFiles([...e.target.files]);

['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); }));
dropZone.addEventListener('drop', (e) => setFiles([...e.dataTransfer.files]));

processBtn.onclick = processAll;
downloadAllBtn.onclick = async () => {
  for (const o of outputs) {
    downloadBlob(o.blob, o.name.replace(/\.[^.]+$/, '_framed.jpg'));
    await new Promise(r => setTimeout(r, 120));
  }
};

function setFiles(newFiles) {
  files = newFiles.filter(f => /image|heic|heif|raw/i.test(f.type) || /\.(heic|heif|jpe?g|png|webp|nef|cr2|cr3|arw|dng)$/i.test(f.name));
  outputs = [];
  resultsEl.innerHTML = '';
  status(`${files.length} file(s) selected.`);
  setProgress(0);
  processBtn.disabled = files.length === 0;
  downloadAllBtn.disabled = true;
}

async function processAll() {
  const siteText = $('siteText').value.trim() || 'tarushv.com';
  const barRatio = Number($('barRatio').value) || 0.082;
  const fallbackDevice = $('fallbackDevice')?.value || 'unknown';
  outputs = [];
  resultsEl.innerHTML = '';
  setProgress(0);

  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status(`Processing ${i + 1}/${files.length}: ${file.name}`);

    try {
      const exif = await readExif(file);
      const decoded = await decodeImageFile(file);

      if (decoded.width < 320 || decoded.height < 320) {
        throw new Error('Image is too small (likely a thumbnail/preview). Use the original file export.');
      }

      const cleaned = stripExistingFooter(decoded);
      const framed = await frameImage(cleaned, exif, siteText, barRatio, fallbackDevice, file.name);
      const blob = await canvasToBlob(framed, 'image/jpeg', 0.95);

      const meta = summarizeExif(exif, fallbackDevice, file.name);
      outputs.push({ name: file.name, blob, meta });
      renderCard(blob, file.name, meta);
    } catch (err) {
      failed += 1;
      console.warn('Failed to process', file.name, err);
      renderErrorCard(file.name, err?.message || 'Processing failed');
    }

    setProgress(((i + 1) / files.length) * 100);
  }

  status(`Done. ${outputs.length} image(s) framed locally in your browser.${failed ? ` ${failed} failed.` : ''}`);
  downloadAllBtn.disabled = outputs.length === 0;
}

function status(text) { statusEl.textContent = text; }
function setProgress(pct) { progressBarEl.style.width = `${Math.max(0, Math.min(100, pct))}%`; }

async function readExif(file) {
  try {
    return await exifr.parse(file, {
      tiff: true,
      ifd0: true,
      exif: true,
      gps: true,
      xmp: true,
      icc: true,
      iptc: true,
      translateKeys: true,
      reviveValues: true,
      mergeOutput: true,
    }) || {};
  } catch {
    return {};
  }
}

async function decodeImageFile(file) {
  const ext = file.name.toLowerCase();
  const isHeic = ext.endsWith('.heic') || ext.endsWith('.heif') || /heic|heif/i.test(file.type);
  const isRaw = /\.(nef|cr2|cr3|arw|dng)$/i.test(ext);

  let srcBlob = file;
  if (isHeic) {
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
    srcBlob = Array.isArray(converted) ? converted[0] : converted;
  } else if (isRaw) {
    // Browser RAW decode is limited. Try to use embedded preview thumbnail.
    const thumb = await exifr.thumbnail(file).catch(() => null);
    if (thumb) {
      srcBlob = thumb;
    } else {
      throw new Error('RAW preview not found. For full-quality RAW framing, export JPG/HEIC first.');
    }
  }

  return await createImageBitmap(srcBlob);
}

function firstDefined(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function numFrom(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (Array.isArray(v) && v.length) return numFrom(v[0]);
  if (typeof v === 'object') {
    if ('numerator' in v && 'denominator' in v) {
      const d = Number(v.denominator) || 1;
      return Number(v.numerator) / d;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function brandFromExif(exif) {
  const make = String(firstDefined(exif, ['Make', 'make', 'LensMake']) || '').toLowerCase();
  const model = String(firstDefined(exif, ['Model', 'model', 'LensModel']) || '').toLowerCase();
  const software = String(firstDefined(exif, ['Software', 'HostComputer']) || '').toLowerCase();
  const s = `${make} ${model} ${software}`;

  const matchers = [
    ['nikon', 'nikon'],
    ['canon', 'canon'],
    ['sony', 'sony'],
    ['fujifilm', 'fujifilm'],
    ['fuji', 'fujifilm'],
    ['samsung', 'samsung'],
    ['google', 'google'],
    ['pixel', 'google'],
    ['dji', 'dji'],
    ['gopro', 'gopro'],
    ['panasonic', 'panasonic'],
    ['leica', 'leica'],
    ['apple', 'apple'],
    ['iphone', 'apple'],
    ['ipad', 'apple'],
    ['ipod', 'apple'],
  ];

  for (const [needle, brand] of matchers) {
    if (s.includes(needle)) return brand;
  }
  return 'unknown';
}

function normalizeDate(dt) {
  if (!dt) return '';
  if (dt instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}:${pad(dt.getMonth()+1)}:${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }
  const s = String(dt).replace('T', ' ');
  // Keep footer compact to avoid overlap
  return s.length > 16 ? s.slice(0, 16) : s;
}

function summarizeExif(exif, fallbackDevice = 'unknown', sourceName = '') {
  const make = firstDefined(exif, ['Make', 'make']) || '';
  const model = firstDefined(exif, ['Model', 'model']) || '';
  const hasExifData = Object.keys(exif || {}).length > 0;
  let brand = brandFromExif(exif);
  let camera;
  if (make || model) {
    camera = `${make} ${model}`.trim();
  } else {
    if (fallbackDevice === 'apple_ipad') {
      brand = 'apple';
      camera = 'Apple iPad';
    } else if (fallbackDevice === 'apple_iphone') {
      brand = 'apple';
      camera = 'Apple iPhone';
    } else if (fallbackDevice === 'nikon') {
      brand = 'nikon';
      camera = 'Nikon Camera';
    } else {
      camera = (brand !== 'unknown' ? brand.toUpperCase() : 'Unknown Camera');
    }
  }

  const exposureTime = numFrom(firstDefined(exif, ['ExposureTime', 'exposureTime']));
  const shutterApex = numFrom(firstDefined(exif, ['ShutterSpeedValue', 'ShutterSpeed']));
  const shutterSeconds = exposureTime > 0 ? exposureTime : (shutterApex ? Math.pow(2, -shutterApex) : 0);

  const fNumber = numFrom(firstDefined(exif, ['FNumber', 'fNumber']));
  const apertureApex = numFrom(firstDefined(exif, ['ApertureValue', 'MaxApertureValue']));
  const aperture = fNumber > 0 ? fNumber : (apertureApex ? Math.pow(2, apertureApex / 2) : 0);

  const isoRaw = firstDefined(exif, [
    'ISOSpeedRatings',
    'PhotographicSensitivity',
    'ISO',
    'ISOValue',
    'RecommendedExposureIndex',
    'StandardOutputSensitivity',
    'iso',
  ]);
  const isoNum = numFrom(isoRaw);
  const iso = isoNum > 0 ? Math.round(isoNum) : (isoRaw || '?');

  const focalRaw = numFrom(firstDefined(exif, ['FocalLength', 'focalLength']));
  const focal35 = numFrom(firstDefined(exif, ['FocalLengthIn35mmFormat', 'FocalLengthIn35mmFilm']));

  const isAppleDevice = /apple|iphone|ipad|ipod/i.test(`${make} ${model}`);

  let focal = '?mm';
  // Match iOS Photos behavior: prefer 35mm-equivalent field when present.
  if (focal35 > 0) {
    focal = `${Math.round(focal35)}mm`;
  } else if (focalRaw > 0) {
    focal = `${Math.round(focalRaw)}mm`;
  }

  // Optional: if non-Apple and both are available, show both for transparency.
  if (!isAppleDevice && focalRaw > 0 && focal35 > 0 && Math.round(focalRaw) !== Math.round(focal35)) {
    focal = `${Math.round(focalRaw)}mm (${Math.round(focal35)}mm eq)`;
  }

  const dt = normalizeDate(firstDefined(exif, ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'DateTime', 'ModifyDate']));

  return {
    brand,
    camera,
    hasExifData,
    aperture: aperture > 0 ? `f/${aperture.toFixed(1)}` : 'f/?',
    shutter: shutterSeconds > 0 ? formatShutter(shutterSeconds) : '?s',
    iso: hasExifData ? iso : '?',
    focal: hasExifData ? focal : '?mm',
    dt,
  };
}

function formatShutter(n) {
  if (!n || n <= 0) return '?s';
  if (n >= 1) return `${n.toFixed(1).replace('.0','')}s`;
  return `1/${Math.round(1 / n)}s`;
}

function ellipsize(ctx, text, maxWidth) {
  const s = String(text ?? '');
  if (!s || maxWidth <= 0) return '';
  if (ctx.measureText(s).width <= maxWidth) return s;
  const dots = '…';
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const cand = s.slice(0, mid) + dots;
    if (ctx.measureText(cand).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + dots;
}

function fitFontPx(ctx, text, family, weight, maxPx, minPx, maxWidth) {
  let px = maxPx;
  while (px > minPx) {
    ctx.font = `${weight ? weight + ' ' : ''}${px}px ${family}`;
    if (ctx.measureText(String(text ?? '')).width <= maxWidth) return px;
    px -= 1;
  }
  return minPx;
}

async function frameImage(bitmap, exif, siteText, barRatio, fallbackDevice = 'unknown', sourceName = '') {
  const meta = summarizeExif(exif, fallbackDevice, sourceName);
  const w = bitmap.width, h = bitmap.height;
  const barH = Math.max(88, Math.floor(h * barRatio));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + barH;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0);

  const y0 = h;
  ctx.strokeStyle = '#e5e5e5';
  ctx.lineWidth = Math.max(1, Math.floor(barH * 0.02));
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(w, y0);
  ctx.stroke();

  const padX = Math.floor(w * 0.022);
  const logoH = Math.floor(barH * 0.56);
  const logoY = y0 + Math.floor((barH - logoH) / 2);

  const logo = logos[meta.brand] || logos.unknown;
  const logoW = Math.max(1, Math.floor((logo.width / logo.height) * logoH));
  ctx.drawImage(logo, padX, logoY, logoW, logoH);

  const leftX = padX + logoW + Math.floor(w * 0.018);
  const centerX = Math.floor(w * 0.5);
  const centerGap = Math.max(14, Math.floor(w * 0.02));
  const focalBoxW = Math.max(140, Math.min(360, Math.floor(w * 0.30)));

  const leftMaxX = centerX - Math.floor(focalBoxW / 2) - centerGap;
  const rightMinX = centerX + Math.floor(focalBoxW / 2) + centerGap;
  const leftWidth = Math.max(40, leftMaxX - leftX);
  const rightWidth = Math.max(40, (w - padX) - rightMinX);

  const modelFont = Math.max(14, Math.floor(barH * 0.245));
  const metaFont = Math.max(13, Math.floor(barH * 0.215));
  const focalFont = Math.max(16, Math.floor(barH * 0.33));
  const rightFont = Math.max(14, Math.floor(barH * 0.22));

  ctx.textBaseline = 'middle';

  // Left block (camera + exposure)
  ctx.fillStyle = '#000';
  ctx.textAlign = 'left';
  ctx.font = `${modelFont}px Sora`;
  const leftTop = ellipsize(ctx, meta.camera, leftWidth);
  ctx.fillText(leftTop, leftX, y0 + Math.floor(barH * 0.36));

  ctx.fillStyle = '#222';
  ctx.font = `${metaFont}px Sora`;
  const leftBottom = ellipsize(ctx, `${meta.aperture}  ${meta.shutter}  ISO${meta.iso}`, leftWidth);
  ctx.fillText(leftBottom, leftX, y0 + Math.floor(barH * 0.67));

  // Center focal block (never ellipsize focal; shrink font instead)
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  const focalPx = fitFontPx(ctx, meta.focal, 'Sora', '700', focalFont, Math.max(12, focalFont - 8), focalBoxW);
  ctx.font = `700 ${focalPx}px Sora`;
  ctx.fillText(String(meta.focal), centerX, y0 + Math.floor(barH / 2));

  // Right block (site + datetime)
  ctx.textAlign = 'right';
  ctx.font = `${rightFont}px Sora`;
  const siteShort = ellipsize(ctx, siteText, rightWidth);
  ctx.fillText(siteShort, w - padX, y0 + Math.floor(barH * 0.40));
  if (meta.dt) {
    ctx.fillStyle = '#333';
    const dtShort = ellipsize(ctx, String(meta.dt), rightWidth);
    ctx.fillText(dtShort, w - padX, y0 + Math.floor(barH * 0.72));
  }

  return c;
}

function renderCard(blob, filename, meta) {
  const url = URL.createObjectURL(blob);
  const card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = `
    <img src="${url}" alt="${filename}">
    <div class="meta">
      <div class="name">${filename}</div>
      <div>${meta.camera}</div>
      <div>${meta.aperture} · ${meta.shutter} · ISO${meta.iso} · ${meta.focal}</div>
      ${meta.hasExifData ? '' : '<div style="color:#ffbf7a">No EXIF found in source file</div>'}
    </div>`;
  resultsEl.appendChild(card);
}

function renderErrorCard(filename, message) {
  const card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = `
    <div class="meta">
      <div class="name">${filename}</div>
      <div style="color:#ff9b9b">Could not process</div>
      <div>${message}</div>
    </div>`;
  resultsEl.appendChild(card);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function stripExistingFooter(bitmap) {
  const w = bitmap.width;
  const h = bitmap.height;
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);

  const minFooter = Math.max(72, Math.floor(h * 0.06));
  const maxFooter = Math.max(minFooter, Math.floor(h * 0.2));

  for (let fh = maxFooter; fh >= minFooter; fh--) {
    const y = h - fh;
    const sample = ctx.getImageData(0, y, w, fh).data;
    let sumR = 0, sumG = 0, sumB = 0, px = 0;
    for (let i = 0; i < sample.length; i += 40) { // stride for speed
      sumR += sample[i];
      sumG += sample[i + 1];
      sumB += sample[i + 2];
      px += 1;
    }
    const r = sumR / px;
    const g = sumG / px;
    const b = sumB / px;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);

    if (Math.min(r, g, b) >= 225 && spread <= 14) {
      const cropped = document.createElement('canvas');
      cropped.width = w;
      cropped.height = y;
      const c2 = cropped.getContext('2d');
      c2.drawImage(probe, 0, 0, w, y, 0, 0, w, y);
      return cropped;
    }
  }

  return probe;
}

async function loadLogo(path) {
  const img = new Image();
  img.src = path;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

async function loadLogos() {
  const out = {};
  for (const [brand, path] of Object.entries(BRAND_LOGO_PATHS)) {
    out[brand] = await loadLogo(path);
  }
  if (!out.unknown) {
    const fallback = new Image();
    fallback.src = './assets/camera.svg';
    await fallback.decode();
    out.unknown = fallback;
  }
  return out;
}

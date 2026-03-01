import exifr from 'https://cdn.jsdelivr.net/npm/exifr/dist/lite.esm.js';
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
      const framed = await frameImage(decoded, exif, siteText, barRatio);
      const blob = await canvasToBlob(framed, 'image/jpeg', 0.95);

      const meta = summarizeExif(exif);
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
  if (!dt) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (dt instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}:${pad(dt.getMonth()+1)}:${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  }
  return String(dt);
}

function summarizeExif(exif) {
  const make = firstDefined(exif, ['Make', 'make']) || '';
  const model = firstDefined(exif, ['Model', 'model']) || '';
  const brand = brandFromExif(exif);
  const camera = (make || model)
    ? `${make} ${model}`.trim()
    : (brand !== 'unknown' ? brand.toUpperCase() : 'Unknown Camera');

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

  const dt = normalizeDate(firstDefined(exif, ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'DateTime', 'ModifyDate']));

  return {
    brand,
    camera,
    aperture: aperture > 0 ? `f/${aperture.toFixed(1)}` : 'f/?',
    shutter: shutterSeconds > 0 ? formatShutter(shutterSeconds) : '?s',
    iso,
    focal: focalRaw > 0 ? `${Math.round(focalRaw)}mm` : (focal35 > 0 ? `${Math.round(focal35)}mm` : '?mm'),
    dt,
  };
}

function formatShutter(n) {
  if (!n || n <= 0) return '?s';
  if (n >= 1) return `${n.toFixed(1).replace('.0','')}s`;
  return `1/${Math.round(1 / n)}s`;
}

async function frameImage(bitmap, exif, siteText, barRatio) {
  const meta = summarizeExif(exif);
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

  const x = padX + logoW + Math.floor(w * 0.018);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';

  ctx.font = `${Math.max(14, Math.floor(barH * 0.245))}px Sora`;
  ctx.fillText(meta.camera, x, y0 + Math.floor(barH * 0.36));

  ctx.fillStyle = '#222';
  ctx.font = `${Math.max(13, Math.floor(barH * 0.215))}px Sora`;
  ctx.fillText(`${meta.aperture}  ${meta.shutter}  ISO${meta.iso}`, x, y0 + Math.floor(barH * 0.67));

  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.max(16, Math.floor(barH * 0.33))}px Sora`;
  ctx.fillText(meta.focal, Math.floor(w * 0.50), y0 + Math.floor(barH / 2));

  ctx.textAlign = 'right';
  ctx.font = `${Math.max(14, Math.floor(barH * 0.22))}px Sora`;
  ctx.fillText(siteText, w - padX, y0 + Math.floor(barH * 0.40));
  ctx.fillStyle = '#333';
  ctx.fillText(String(meta.dt), w - padX, y0 + Math.floor(barH * 0.72));

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

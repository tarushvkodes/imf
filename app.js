import exifr from 'https://cdn.jsdelivr.net/npm/exifr/dist/lite.esm.js';
import heic2any from 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm';

const logos = {
  apple: await loadLogo('./assets/apple.svg'),
  nikon: await loadLogo('./assets/nikon.svg'),
  unknown: await loadLogo('./assets/camera.svg'),
};

const $ = (id) => document.getElementById(id);
const input = $('fileInput');
const dropZone = $('dropZone');
const statusEl = $('status');
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
  files = newFiles.filter(f => /image|heic|heif/i.test(f.type) || /\.(heic|heif|jpe?g|png)$/i.test(f.name));
  outputs = [];
  resultsEl.innerHTML = '';
  status(`${files.length} file(s) selected.`);
  processBtn.disabled = files.length === 0;
  downloadAllBtn.disabled = true;
}

async function processAll() {
  const siteText = $('siteText').value.trim() || 'tarushv.com';
  const barRatio = Number($('barRatio').value) || 0.082;
  outputs = [];
  resultsEl.innerHTML = '';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status(`Processing ${i + 1}/${files.length}: ${file.name}`);
    const exif = await readExif(file);
    const decoded = await decodeImageFile(file);
    const framed = await frameImage(decoded, exif, siteText, barRatio);
    const blob = await canvasToBlob(framed, 'image/jpeg', 0.95);
    const meta = summarizeExif(exif);
    outputs.push({ name: file.name, blob, meta });
    renderCard(blob, file.name, meta);
  }

  status(`Done. ${outputs.length} image(s) framed locally in your browser.`);
  downloadAllBtn.disabled = outputs.length === 0;
}

function status(text) { statusEl.textContent = text; }

async function readExif(file) {
  try {
    return await exifr.parse(file, {
      tiff: true,
      ifd0: true,
      exif: true,
      gps: true,
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

  let srcBlob = file;
  if (isHeic) {
    try {
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
      srcBlob = Array.isArray(converted) ? converted[0] : converted;
    } catch (e) {
      throw new Error('HEIC decode failed in browser.');
    }
  }

  const bitmap = await createImageBitmap(srcBlob);
  return bitmap;
}

function brandFromExif(exif) {
  const make = String(exif?.Make || '').toLowerCase();
  const model = String(exif?.Model || '').toLowerCase();
  const s = `${make} ${model}`;
  if (s.includes('nikon')) return 'nikon';
  if (['apple','iphone','ipad','ipod'].some(k => s.includes(k))) return 'apple';
  return 'unknown';
}

function summarizeExif(exif) {
  const make = exif?.Make || '';
  const model = exif?.Model || '';
  const brand = brandFromExif(exif);
  const camera = (make || model) ? `${make} ${model}`.trim() : 'Unknown Camera';
  return {
    brand,
    camera,
    aperture: exif?.FNumber ? `f/${Number(exif.FNumber).toFixed(1)}` : 'f/?',
    shutter: exif?.ExposureTime ? formatShutter(exif.ExposureTime) : '?s',
    iso: exif?.ISOSpeedRatings || exif?.PhotographicSensitivity || '?',
    focal: exif?.FocalLength ? `${Math.round(Number(exif.FocalLength))}mm` : '?mm',
    dt: exif?.DateTimeOriginal || exif?.DateTime || new Date().toISOString().slice(0, 19).replace('T',' '),
  };
}

function formatShutter(v) {
  const n = Number(v);
  if (!n || n <= 0) return '?s';
  if (n >= 1) return `${n.toFixed(1).replace('.0','')}s`;
  return `1/${Math.round(1 / n)}s`;
}

async function frameImage(bitmap, exif, siteText, barRatio) {
  const meta = summarizeExif(exif);
  const w = bitmap.width, h = bitmap.height;
  const barH = Math.max(88, Math.floor(h * barRatio));
  const c = document.createElement('canvas');
  c.width = w; c.height = h + barH;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0);

  const y0 = h;
  ctx.strokeStyle = '#e5e5e5';
  ctx.lineWidth = Math.max(1, Math.floor(barH * 0.02));
  ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();

  const padX = Math.floor(w * 0.022);
  const logoH = Math.floor(barH * 0.56);
  const logoY = y0 + Math.floor((barH - logoH) / 2);

  const logo = logos[meta.brand] || logos.unknown;
  const logoW = Math.max(1, Math.floor((logo.width / logo.height) * logoH));
  ctx.drawImage(logo, padX, logoY, logoW, logoH);

  let x = padX + logoW + Math.floor(w * 0.018);
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
  ctx.fillText(meta.focal, Math.floor(w * 0.62), y0 + Math.floor(barH / 2));

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
  await img.decode();
  return img;
}

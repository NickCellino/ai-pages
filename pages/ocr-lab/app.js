import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache = true;

const pipelineCache = new Map();

function updateProgress(progressEl, value) {
  if (!progressEl) return;
  progressEl.hidden = false;
  progressEl.value = Math.max(0, Math.min(100, value));
}

function hideProgress(progressEl) {
  if (!progressEl) return;
  progressEl.hidden = true;
  progressEl.value = 0;
}

async function getOcrPipeline(statusEl, progressEl, modelId) {
  if (!pipelineCache.has(modelId)) {
    statusEl.textContent = `Loading ${modelId}…`;
    updateProgress(progressEl, 2);

    const promise = pipeline('image-to-text', modelId, {
      progress_callback: (evt) => {
        const pct = typeof evt?.progress === 'number' ? evt.progress * 100 : null;
        if (pct !== null) {
          updateProgress(progressEl, Math.min(95, pct));
          statusEl.textContent = `Loading model files… ${Math.round(pct)}%`;
        }
      },
    });
    pipelineCache.set(modelId, promise);
  }

  const pipe = await pipelineCache.get(modelId);
  statusEl.textContent = 'Model loaded. Ready.';
  statusEl.classList.add('good');
  updateProgress(progressEl, 100);
  setTimeout(() => hideProgress(progressEl), 300);
  return pipe;
}

function preprocessToCanvas(source, enhance) {
  const maxSide = 1500;
  const baseScale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const upscale = 2;
  const scale = Math.max(1, baseScale * upscale);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  if (!enhance) return canvas;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let min = 255;
  let max = 0;
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const g = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const span = Math.max(1, max - min);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const normalized = Math.round(((gray[p] - min) / span) * 255);
    const boosted = normalized < 150 ? normalized * 0.75 : 210 + (normalized - 150) * 0.3;
    const val = Math.max(0, Math.min(255, Math.round(boosted)));
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function detectTextLines(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  const rowInk = new Float32Array(height);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      if (data[idx] < 160) count += 1;
    }
    rowInk[y] = count / width;
  }

  const threshold = 0.015;
  const minLineHeight = Math.max(12, Math.round(height * 0.012));
  const mergeGap = Math.max(8, Math.round(height * 0.01));

  const lines = [];
  let start = -1;
  for (let y = 0; y < height; y += 1) {
    if (rowInk[y] >= threshold) {
      if (start === -1) start = y;
    } else if (start !== -1) {
      const h = y - start;
      if (h >= minLineHeight) lines.push([start, y]);
      start = -1;
    }
  }
  if (start !== -1 && height - start >= minLineHeight) lines.push([start, height]);

  if (!lines.length) return [[0, height]];

  const merged = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    if (prev && line[0] - prev[1] <= mergeGap) {
      prev[1] = line[1];
    } else {
      merged.push(line.slice());
    }
  }

  const padding = Math.round(height * 0.01);
  return merged.slice(0, 25).map(([top, bottom]) => {
    const y1 = Math.max(0, top - padding);
    const y2 = Math.min(height, bottom + padding);
    return [y1, y2];
  });
}

function cropToDataUrl(canvas, y1, y2) {
  const h = Math.max(1, Math.floor(y2 - y1));
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = h;
  out.getContext('2d').drawImage(canvas, 0, y1, canvas.width, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

async function runLineByLineOcr(pipe, canvas, status, progress, maxTokens = 128) {
  const lines = detectTextLines(canvas);
  const output = [];

  for (let i = 0; i < lines.length; i += 1) {
    const [y1, y2] = lines[i];
    const dataUrl = cropToDataUrl(canvas, y1, y2);
    status.textContent = `OCR line ${i + 1}/${lines.length}…`;
    updateProgress(progress, Math.round((i / lines.length) * 100));

    const out = await pipe(dataUrl, { max_new_tokens: maxTokens });
    const text = out?.[0]?.generated_text?.trim();
    if (text) output.push(text);
  }

  updateProgress(progress, 100);
  return output.join('\n');
}

function setBusy(statusEl, runBtn, busyText) {
  runBtn.disabled = true;
  statusEl.classList.remove('good');
  statusEl.textContent = busyText;
}

function clearBusy(statusEl, runBtn, doneText = 'Done.') {
  runBtn.disabled = false;
  statusEl.classList.add('good');
  statusEl.textContent = doneText;
}

async function setupWholeImage() {
  const upload = document.getElementById('upload');
  const preview = document.getElementById('preview');
  const run = document.getElementById('run');
  const clear = document.getElementById('clear');
  const result = document.getElementById('result');
  const status = document.getElementById('status');
  const modelSelect = document.getElementById('model-select');
  const ocrMode = document.getElementById('ocr-mode');
  const enhance = document.getElementById('enhance');
  const progress = document.getElementById('progress');

  let imageDataUrl = '';
  let imageEl = null;

  const prewarm = () => getOcrPipeline(status, progress, modelSelect.value).catch((err) => {
    status.textContent = `Failed to load model: ${err.message}`;
  });
  prewarm();

  modelSelect.addEventListener('change', () => {
    status.textContent = 'Model changed. Warming cache…';
    prewarm();
  });

  upload.addEventListener('change', () => {
    const [file] = upload.files;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      imageDataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        imageEl = img;
        run.disabled = false;
        status.classList.remove('good');
        status.textContent = 'Image loaded. Ready to run OCR.';
      };
      img.src = imageDataUrl;

      preview.src = imageDataUrl;
      preview.hidden = false;
      result.value = '';
    };
    reader.readAsDataURL(file);
  });

  run.addEventListener('click', async () => {
    if (!imageDataUrl || !imageEl) return;

    try {
      setBusy(status, run, 'Preparing image…');
      updateProgress(progress, 4);

      const processed = preprocessToCanvas(imageEl, enhance.checked);
      const ocr = await getOcrPipeline(status, progress, modelSelect.value);

      let text = '';
      if (ocrMode.value === 'line') {
        text = await runLineByLineOcr(ocr, processed, status, progress);
      } else {
        status.textContent = 'Running OCR on full image…';
        updateProgress(progress, 35);
        const out = await ocr(processed.toDataURL('image/png'), { max_new_tokens: 256 });
        text = out?.[0]?.generated_text?.trim() || '';
        updateProgress(progress, 100);
      }

      result.value = text || '[No text detected]';
      clearBusy(status, run, 'OCR complete.');
      setTimeout(() => hideProgress(progress), 500);
    } catch (err) {
      status.textContent = `OCR error: ${err.message}`;
      run.disabled = false;
      hideProgress(progress);
    }
  });

  clear.addEventListener('click', () => {
    upload.value = '';
    preview.hidden = true;
    preview.src = '';
    imageDataUrl = '';
    imageEl = null;
    result.value = '';
    run.disabled = true;
    status.classList.remove('good');
    status.textContent = 'Cleared. Upload a new image.';
    hideProgress(progress);
  });
}

async function setupRegionOcr() {
  const upload = document.getElementById('upload');
  const canvas = document.getElementById('canvas');
  const run = document.getElementById('run');
  const reset = document.getElementById('reset');
  const result = document.getElementById('result');
  const status = document.getElementById('status');
  const ctx = canvas.getContext('2d');

  let img = null;
  let selection = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) {
      ctx.fillStyle = '#10204a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#b8c4ff';
      ctx.font = '16px sans-serif';
      ctx.fillText('Upload an image to begin.', 20, 30);
      return;
    }

    const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    const ox = (canvas.width - w) / 2;
    const oy = (canvas.height - h) / 2;
    ctx.drawImage(img, ox, oy, w, h);

    if (selection) {
      ctx.strokeStyle = '#7c9cff';
      ctx.lineWidth = 2;
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      ctx.fillStyle = 'rgba(124, 156, 255, 0.2)';
      ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
    }
  }

  draw();

  getOcrPipeline(status, null, 'Xenova/trocr-base-printed').catch((err) => {
    status.textContent = `Failed to load model: ${err.message}`;
  });

  upload.addEventListener('change', () => {
    const [file] = upload.files;
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      img = image;
      selection = null;
      draw();
      run.disabled = false;
      result.value = '';
      status.classList.remove('good');
      status.textContent = 'Image loaded. Draw a region, then click OCR Selection.';
    };
    image.src = url;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!img) return;
    const rect = canvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    dragging = true;
    selection = { x: startX, y: startY, w: 0, h: 0 };
    draw();
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!dragging || !img) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    selection = {
      x: Math.min(startX, x),
      y: Math.min(startY, y),
      w: Math.abs(x - startX),
      h: Math.abs(y - startY),
    };
    draw();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
  });

  run.addEventListener('click', async () => {
    if (!img) return;
    if (!selection || selection.w < 8 || selection.h < 8) {
      status.textContent = 'Please draw a larger selection first.';
      return;
    }

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.floor(selection.w);
    cropCanvas.height = Math.floor(selection.h);
    const cropCtx = cropCanvas.getContext('2d');

    cropCtx.drawImage(
      canvas,
      selection.x,
      selection.y,
      selection.w,
      selection.h,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );

    try {
      setBusy(status, run, 'Running OCR on selected region…');
      const ocr = await getOcrPipeline(status, null, 'Xenova/trocr-base-printed');
      const prep = preprocessToCanvas(cropCanvas, true);
      const out = await ocr(prep.toDataURL('image/png'), { max_new_tokens: 128 });
      result.value = out?.[0]?.generated_text?.trim() || '[No text detected]';
      clearBusy(status, run, 'Region OCR complete.');
    } catch (err) {
      status.textContent = `OCR error: ${err.message}`;
      run.disabled = false;
    }
  });

  reset.addEventListener('click', () => {
    selection = null;
    draw();
    status.classList.remove('good');
    status.textContent = 'Selection cleared. Draw a new region.';
  });
}

const pageType = document.querySelector('main')?.dataset.page;
if (pageType === 'whole') {
  setupWholeImage();
} else if (pageType === 'region') {
  setupRegionOcr();
}

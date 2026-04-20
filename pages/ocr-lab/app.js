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
  setTimeout(() => hideProgress(progressEl), 350);
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
  return merged.slice(0, 30).map(([top, bottom]) => {
    const y1 = Math.max(0, top - padding);
    const y2 = Math.min(height, bottom + padding);
    return [y1, y2];
  });
}

function findTextRegions(canvas) {
  // Downscale for faster connected component labeling.
  const maxDetectSide = 900;
  const scale = Math.min(1, maxDetectSide / Math.max(canvas.width, canvas.height));

  const detectCanvas = document.createElement('canvas');
  detectCanvas.width = Math.max(1, Math.round(canvas.width * scale));
  detectCanvas.height = Math.max(1, Math.round(canvas.height * scale));
  const dctx = detectCanvas.getContext('2d', { willReadFrequently: true });
  dctx.drawImage(canvas, 0, 0, detectCanvas.width, detectCanvas.height);

  const { width, height } = detectCanvas;
  const data = dctx.getImageData(0, 0, width, height).data;

  const binary = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    binary[p] = data[i] < 165 ? 1 : 0;
  }

  const visited = new Uint8Array(width * height);
  const boxes = [];

  const stackX = [];
  const stackY = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!binary[index] || visited[index]) continue;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;

      stackX.push(x);
      stackY.push(y);
      visited[index] = 1;

      while (stackX.length) {
        const cx = stackX.pop();
        const cy = stackY.pop();
        area += 1;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let ny = cy - 1; ny <= cy + 1; ny += 1) {
          if (ny < 0 || ny >= height) continue;
          for (let nx = cx - 1; nx <= cx + 1; nx += 1) {
            if (nx < 0 || nx >= width) continue;
            const ni = ny * width + nx;
            if (!binary[ni] || visited[ni]) continue;
            visited[ni] = 1;
            stackX.push(nx);
            stackY.push(ny);
          }
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (area < 20 || bw < 8 || bh < 8) continue;
      boxes.push({ x: minX, y: minY, w: bw, h: bh });
    }
  }

  // Merge nearby components into text regions.
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  const merged = [];
  const pad = 3;

  for (const box of boxes) {
    let attached = false;
    for (const m of merged) {
      const overlapY = Math.max(0, Math.min(m.y + m.h, box.y + box.h) - Math.max(m.y, box.y));
      const gapX = Math.max(0, Math.max(m.x, box.x) - Math.min(m.x + m.w, box.x + box.w));
      const similarRow = overlapY > Math.min(m.h, box.h) * 0.35;
      if (similarRow && gapX < 26) {
        const x1 = Math.min(m.x, box.x);
        const y1 = Math.min(m.y, box.y);
        const x2 = Math.max(m.x + m.w, box.x + box.w);
        const y2 = Math.max(m.y + m.h, box.y + box.h);
        m.x = x1;
        m.y = y1;
        m.w = x2 - x1;
        m.h = y2 - y1;
        attached = true;
        break;
      }
    }
    if (!attached) merged.push({ ...box });
  }

  // Convert back to original canvas coordinates.
  const inv = 1 / scale;
  const minRegionArea = 200;
  return merged
    .map((b) => ({
      x: Math.max(0, Math.floor((b.x - pad) * inv)),
      y: Math.max(0, Math.floor((b.y - pad) * inv)),
      w: Math.ceil((b.w + pad * 2) * inv),
      h: Math.ceil((b.h + pad * 2) * inv),
    }))
    .filter((b) => b.w * b.h > minRegionArea)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 40);
}

function cropRectToDataUrl(canvas, rect) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.floor(rect.w));
  out.height = Math.max(1, Math.floor(rect.h));
  out
    .getContext('2d')
    .drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function drawPreviewWithBoxes(previewCanvas, sourceCanvas, boxes = []) {
  const ctx = previewCanvas.getContext('2d');
  const ratio = Math.min(previewCanvas.width / sourceCanvas.width, previewCanvas.height / sourceCanvas.height);
  const w = sourceCanvas.width * ratio;
  const h = sourceCanvas.height * ratio;
  const ox = (previewCanvas.width - w) / 2;
  const oy = (previewCanvas.height - h) / 2;

  ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  ctx.fillStyle = '#08112e';
  ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
  ctx.drawImage(sourceCanvas, ox, oy, w, h);

  if (!boxes.length) return;
  ctx.strokeStyle = '#39d98a';
  ctx.fillStyle = 'rgba(57, 217, 138, 0.2)';
  ctx.lineWidth = 2;
  for (const b of boxes) {
    const x = ox + b.x * ratio;
    const y = oy + b.y * ratio;
    const bw = b.w * ratio;
    const bh = b.h * ratio;
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeRect(x, y, bw, bh);
  }
}

async function runLineByLineOcr(pipe, canvas, status, progress, maxTokens = 128) {
  const lines = detectTextLines(canvas);
  const output = [];

  for (let i = 0; i < lines.length; i += 1) {
    const [y1, y2] = lines[i];
    const dataUrl = cropRectToDataUrl(canvas, { x: 0, y: y1, w: canvas.width, h: y2 - y1 });
    status.textContent = `OCR line ${i + 1}/${lines.length}…`;
    updateProgress(progress, Math.round((i / lines.length) * 100));

    const out = await pipe(dataUrl, { max_new_tokens: maxTokens });
    const text = out?.[0]?.generated_text?.trim();
    if (text) output.push(text);
  }

  updateProgress(progress, 100);
  return output.join('\n');
}

async function runRegionDetectOcr(pipe, canvas, status, progress, previewCanvas, maxTokens = 128) {
  const boxes = findTextRegions(canvas);
  drawPreviewWithBoxes(previewCanvas, canvas, boxes);

  const chunks = [];
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    status.textContent = `OCR detected region ${i + 1}/${boxes.length}…`;
    updateProgress(progress, Math.round((i / Math.max(1, boxes.length)) * 100));

    const out = await pipe(cropRectToDataUrl(canvas, b), { max_new_tokens: maxTokens });
    const text = out?.[0]?.generated_text?.trim();
    if (text) chunks.push(text);
  }

  updateProgress(progress, 100);
  return { text: chunks.join('\n'), boxes };
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
  const previewCanvas = document.getElementById('preview-canvas');
  const run = document.getElementById('run');
  const clear = document.getElementById('clear');
  const result = document.getElementById('result');
  const status = document.getElementById('status');
  const modelSelect = document.getElementById('model-select');
  const ocrMode = document.getElementById('ocr-mode');
  const enhance = document.getElementById('enhance');
  const progress = document.getElementById('progress');

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
      const imageDataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        imageEl = img;
        run.disabled = false;
        status.classList.remove('good');
        status.textContent = 'Image loaded. Ready to run OCR.';

        const base = preprocessToCanvas(imageEl, false);
        drawPreviewWithBoxes(previewCanvas, base, []);
        previewCanvas.hidden = false;
      };
      img.src = imageDataUrl;
      result.value = '';
    };
    reader.readAsDataURL(file);
  });

  run.addEventListener('click', async () => {
    if (!imageEl) return;

    try {
      setBusy(status, run, 'Preparing image…');
      updateProgress(progress, 4);

      const processed = preprocessToCanvas(imageEl, enhance.checked);
      const ocr = await getOcrPipeline(status, progress, modelSelect.value);

      let text = '';
      if (ocrMode.value === 'line') {
        drawPreviewWithBoxes(previewCanvas, processed, []);
        text = await runLineByLineOcr(ocr, processed, status, progress);
      } else if (ocrMode.value === 'region') {
        const out = await runRegionDetectOcr(ocr, processed, status, progress, previewCanvas);
        text = out.text;
        if (!out.boxes.length) {
          status.textContent = 'No text regions detected. Try disabling enhancement or using a clearer image.';
        }
      } else {
        status.textContent = 'Running OCR on full image…';
        drawPreviewWithBoxes(previewCanvas, processed, []);
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
    imageEl = null;
    result.value = '';
    run.disabled = true;
    previewCanvas.hidden = true;
    previewCanvas.getContext('2d').clearRect(0, 0, previewCanvas.width, previewCanvas.height);
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

  function getImageRect() {
    if (!img) return null;
    const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    const ox = (canvas.width - w) / 2;
    const oy = (canvas.height - h) / 2;
    return { ox, oy, w, h, ratio };
  }

  function clampSelectionToImage(sel) {
    const rect = getImageRect();
    if (!rect) return sel;

    const x1 = Math.max(rect.ox, Math.min(sel.x, rect.ox + rect.w));
    const y1 = Math.max(rect.oy, Math.min(sel.y, rect.oy + rect.h));
    const x2 = Math.max(rect.ox, Math.min(sel.x + sel.w, rect.ox + rect.w));
    const y2 = Math.max(rect.oy, Math.min(sel.y + sel.h, rect.oy + rect.h));

    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  }

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

    const r = getImageRect();
    ctx.drawImage(img, r.ox, r.oy, r.w, r.h);

    if (selection) {
      ctx.strokeStyle = '#7c9cff';
      ctx.lineWidth = 2;
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      ctx.fillStyle = 'rgba(124, 156, 255, 0.2)';
      ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
    }
  }

  function eventToCanvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
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
    const p = eventToCanvasPoint(e);
    startX = p.x;
    startY = p.y;
    dragging = true;
    selection = { x: startX, y: startY, w: 0, h: 0 };
    draw();
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!dragging || !img) return;
    const p = eventToCanvasPoint(e);
    selection = clampSelectionToImage({
      x: Math.min(startX, p.x),
      y: Math.min(startY, p.y),
      w: Math.abs(p.x - startX),
      h: Math.abs(p.y - startY),
    });
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

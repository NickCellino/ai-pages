import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'Xenova/trocr-base-printed';

let ocrPipelinePromise;

async function getOcrPipeline(statusEl) {
  if (!ocrPipelinePromise) {
    statusEl.textContent = 'Loading OCR model… first run may take ~20-60 seconds.';
    ocrPipelinePromise = pipeline('image-to-text', MODEL_ID);
  }
  const pipe = await ocrPipelinePromise;
  statusEl.textContent = 'Model loaded. Ready.';
  statusEl.classList.add('good');
  return pipe;
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

  let imageDataUrl = '';

  getOcrPipeline(status).catch((err) => {
    status.textContent = `Failed to load model: ${err.message}`;
  });

  upload.addEventListener('change', () => {
    const [file] = upload.files;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      imageDataUrl = String(reader.result || '');
      preview.src = imageDataUrl;
      preview.hidden = false;
      run.disabled = false;
      result.value = '';
      status.classList.remove('good');
      status.textContent = 'Image loaded. Ready to run OCR.';
    };
    reader.readAsDataURL(file);
  });

  run.addEventListener('click', async () => {
    if (!imageDataUrl) return;
    try {
      setBusy(status, run, 'Running OCR on full image…');
      const ocr = await getOcrPipeline(status);
      const out = await ocr(imageDataUrl, { max_new_tokens: 128 });
      result.value = out?.[0]?.generated_text?.trim() || '[No text detected]';
      clearBusy(status, run, 'OCR complete.');
    } catch (err) {
      status.textContent = `OCR error: ${err.message}`;
      run.disabled = false;
    }
  });

  clear.addEventListener('click', () => {
    upload.value = '';
    preview.hidden = true;
    preview.src = '';
    imageDataUrl = '';
    result.value = '';
    run.disabled = true;
    status.classList.remove('good');
    status.textContent = 'Cleared. Upload a new image.';
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

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (selection) {
      ctx.strokeStyle = '#7c9cff';
      ctx.lineWidth = 2;
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      ctx.fillStyle = 'rgba(124, 156, 255, 0.2)';
      ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
    }
  }

  draw();

  getOcrPipeline(status).catch((err) => {
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
      const ocr = await getOcrPipeline(status);
      const out = await ocr(cropCanvas.toDataURL('image/png'), { max_new_tokens: 128 });
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

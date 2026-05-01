const imageInput = document.getElementById('imageInput');
const enableCrop = document.getElementById('enableCrop');
const apiKeyInput = document.getElementById('apiKey');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');
const albumOut = document.getElementById('albumOut');
const artistOut = document.getElementById('artistOut');
const rawOut = document.getElementById('rawOut');

const originalCanvas = document.getElementById('originalCanvas');
const processedCanvas = document.getElementById('processedCanvas');
const octx = originalCanvas.getContext('2d');
const pctx = processedCanvas.getContext('2d');

let loadedImage = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function drawImageContain(ctx, img) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  const scale = Math.min(width / img.width, height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  ctx.drawImage(img, x, y, w, h);
}

function detectSquareRegion(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Very lightweight "dominant square-ish area" detector using edge density.
  const step = 6;
  let best = { score: -1, x: 0, y: 0, size: Math.min(width, height) * 0.7 };
  const minSize = Math.floor(Math.min(width, height) * 0.4);
  const maxSize = Math.floor(Math.min(width, height) * 0.95);

  for (let size = minSize; size <= maxSize; size += 30) {
    for (let y = 0; y <= height - size; y += 24) {
      for (let x = 0; x <= width - size; x += 24) {
        let score = 0;
        for (let i = 0; i < size; i += step) {
          score += edgeAt(data, width, x + i, y);
          score += edgeAt(data, width, x + i, y + size - 1);
          score += edgeAt(data, width, x, y + i);
          score += edgeAt(data, width, x + size - 1, y + i);
        }
        if (score > best.score) best = { score, x, y, size };
      }
    }
  }
  return best;
}

function edgeAt(data, width, x, y) {
  const idx = (y * width + x) * 4;
  const idxR = idx + 4;
  const idxD = idx + width * 4;
  if (idxR >= data.length || idxD >= data.length) return 0;
  const g = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
  const gR = (data[idxR] + data[idxR + 1] + data[idxR + 2]) / 3;
  const gD = (data[idxD] + data[idxD + 1] + data[idxD + 2]) / 3;
  return Math.abs(g - gR) + Math.abs(g - gD);
}

function cropRegion(srcCanvas, rect) {
  const out = document.createElement('canvas');
  out.width = rect.size;
  out.height = rect.size;
  out.getContext('2d').drawImage(
    srcCanvas,
    rect.x,
    rect.y,
    rect.size,
    rect.size,
    0,
    0,
    rect.size,
    rect.size
  );
  return out;
}

async function canvasToBase64Jpeg(canvas) {
  return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
}

async function googleVisionWebDetect(base64Image, apiKey) {
  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;
  const body = {
    requests: [
      {
        image: { content: base64Image },
        features: [{ type: 'WEB_DETECTION', maxResults: 10 }]
      }
    ]
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vision API error: ${res.status} ${text}`);
  }

  return res.json();
}

function inferAlbumArtist(webDetection) {
  const entities = webDetection?.webEntities ?? [];
  const labels = entities.map((e) => e.description).filter(Boolean);

  const joined = labels.join(' | ');
  const patterns = [
    /(.+?)\s+by\s+(.+)/i,
    /(.+?)\s+-\s+(.+)/,
    /(.+?)\s+album\s+(.+)/i
  ];

  for (const label of labels) {
    for (const pattern of patterns) {
      const match = label.match(pattern);
      if (match) {
        return { album: match[1].trim(), artist: match[2].trim(), labels };
      }
    }
  }

  // Heuristic fallback: choose two most specific labels.
  return {
    album: labels[0] || 'Unknown',
    artist: labels[1] || 'Unknown',
    labels
  };
}

imageInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    loadedImage = img;
    drawImageContain(octx, img);
    drawImageContain(pctx, img);
    analyzeBtn.disabled = false;
    setStatus('Image loaded. Ready to analyze.');
  };
  img.src = URL.createObjectURL(file);
});

analyzeBtn.addEventListener('click', async () => {
  if (!loadedImage) return;
  if (!apiKeyInput.value.trim()) {
    setStatus('Please provide a Google Cloud API key.');
    return;
  }

  albumOut.textContent = '…';
  artistOut.textContent = '…';
  rawOut.textContent = '';

  try {
    setStatus('Preparing image...');
    drawImageContain(octx, loadedImage);

    let sourceCanvas = originalCanvas;

    if (enableCrop.checked) {
      const rect = detectSquareRegion(originalCanvas);
      sourceCanvas = cropRegion(originalCanvas, rect);
      pctx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
      pctx.drawImage(sourceCanvas, 0, 0, processedCanvas.width, processedCanvas.height);
      setStatus(`Pre-processing complete (x:${Math.round(rect.x)}, y:${Math.round(rect.y)}, size:${Math.round(rect.size)}).`);
    } else {
      drawImageContain(pctx, loadedImage);
      setStatus('Pre-processing skipped.');
    }

    setStatus('Running reverse image lookup via Google Vision...');
    const imageBase64 = await canvasToBase64Jpeg(sourceCanvas);
    const vision = await googleVisionWebDetect(imageBase64, apiKeyInput.value.trim());

    const webDetection = vision.responses?.[0]?.webDetection;
    const inferred = inferAlbumArtist(webDetection);

    albumOut.textContent = inferred.album;
    artistOut.textContent = inferred.artist;
    rawOut.textContent = JSON.stringify(
      {
        bestGuessLabels: webDetection?.bestGuessLabels,
        webEntities: webDetection?.webEntities?.slice(0, 10),
        pagesWithMatchingImages: webDetection?.pagesWithMatchingImages?.slice(0, 5)
      },
      null,
      2
    );

    setStatus('Done. Review prediction and raw signals.');
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
});

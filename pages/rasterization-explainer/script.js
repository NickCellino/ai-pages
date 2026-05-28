const canvas = document.querySelector('#raster-canvas');
const ctx = canvas.getContext('2d');
const stepButtons = [...document.querySelectorAll('.step')];
const prevButton = document.querySelector('#prev-step');
const nextButton = document.querySelector('#next-step');
const playButton = document.querySelector('#play-pause');
const speed = document.querySelector('#speed');

const labels = {
  stageCount: document.querySelector('#stage-count'),
  stageName: document.querySelector('#stage-name'),
  stageMini: document.querySelector('#stage-mini'),
  title: document.querySelector('#stage-title'),
  description: document.querySelector('#stage-description'),
  input: document.querySelector('#stage-input'),
  output: document.querySelector('#stage-output'),
  visualTitle: document.querySelector('#visual-title'),
  visualBadge: document.querySelector('#visual-badge'),
  inputData: document.querySelector('#input-data'),
  operationData: document.querySelector('#operation-data'),
  outputData: document.querySelector('#output-data')
};

const stages = [
  {
    name: 'Model vertices',
    mini: 'Three points describe a triangle before the screen knows anything about pixels.',
    title: '1. Model vertices',
    description: 'A vector scene starts as math: vertex positions, colors, and triangles. The renderer has exact coordinates, not pixels.',
    input: 'Local-space vertices with per-vertex colors.',
    output: 'A triangle primitive ready for transformation.',
    visualTitle: 'Vector input',
    badge: 'No pixels yet',
    inputData: 'mesh.triangles[0]\nA: (-0.68, -0.52) red\nB: ( 0.60, -0.42) blue\nC: (-0.12,  0.66) gold',
    operationData: 'Group vertices into a primitive.\nKeep attributes attached to each corner.\nNo screen grid is involved yet.',
    outputData: 'primitive = triangle(A, B, C)\nattributes = { color }\nspace = model'
  },
  {
    name: 'Transform to screen space',
    mini: 'Matrices move the triangle from its own local coordinates toward the camera and screen.',
    title: '2. Transform to screen space',
    description: 'The GPU applies model, view, and projection math. The same triangle is now positioned where the camera can see it.',
    input: 'The model-space triangle from step 1.',
    output: 'The same vertices in normalized device coordinates.',
    visualTitle: 'Transformed primitive',
    badge: 'Still vector',
    inputData: 'A, B, C in model space\nplus model × view × projection matrices',
    operationData: 'clipPosition = MVP × vertex\nrotate 18°\nscale to viewport\nprepare perspective divide',
    outputData: 'A: (-0.48, -0.32)\nB: ( 0.55, -0.18)\nC: (-0.03,  0.58)\nspace = clip / NDC'
  },
  {
    name: 'Clip invisible parts',
    mini: 'Anything outside the view volume is removed or split at the boundary.',
    title: '3. Clip against the viewport',
    description: 'Rasterizers only process visible geometry. If a primitive crosses the screen edge, clipping creates a new visible polygon.',
    input: 'A triangle that may extend beyond the visible rectangle.',
    output: 'Only the portion inside the viewport.',
    visualTitle: 'Clipped to view',
    badge: 'Visible shape',
    inputData: 'Transformed primitive\nviewport bounds: -1 ≤ x,y ≤ 1',
    operationData: 'Test edges against the view rectangle.\nFind intersection points where edges leave the view.\nDiscard outside segments.',
    outputData: 'visible polygon\n4 vertices after clipping\nall points are inside viewport'
  },
  {
    name: 'Project onto pixel grid',
    mini: 'Continuous coordinates are mapped to a finite image: rows and columns of pixels.',
    title: '4. Project to the framebuffer',
    description: 'Viewport mapping turns normalized coordinates into pixel coordinates. The grid appears, but the triangle still has crisp mathematical edges.',
    input: 'The visible primitive in normalized screen coordinates.',
    output: 'Screen-space edges over a pixel grid.',
    visualTitle: 'Screen grid projection',
    badge: 'Grid appears',
    inputData: 'NDC positions in range [-1, 1]\nframebuffer: 18 × 12 pixels',
    operationData: 'screenX = (x + 1) × width / 2\nscreenY = (1 - y) × height / 2\ncompute edge equations',
    outputData: 'A: (5.4, 7.9) pixels\nB: (13.8, 6.8) pixels\nC: (9.1, 2.5) pixels'
  },
  {
    name: 'Sample pixel centers',
    mini: 'Each pixel asks: is my center inside the triangle?',
    title: '5. Rasterize coverage samples',
    description: 'Rasterization converts edges into fragments. Pixel centers inside the triangle become candidate fragments; outside samples are rejected.',
    input: 'Screen-space triangle edges and pixel centers.',
    output: 'A coverage mask: which pixels will receive fragments.',
    visualTitle: 'Coverage mask',
    badge: 'Fragments created',
    inputData: 'edge equations\npixel centers at (x + 0.5, y + 0.5)',
    operationData: 'For each pixel center:\n  inside = edge0 ≥ 0 && edge1 ≥ 0 && edge2 ≥ 0\nEmit a fragment when inside.',
    outputData: '23 covered samples\nfragment = { pixel, barycentric weights }'
  },
  {
    name: 'Shade and write pixels',
    mini: 'Fragments receive interpolated colors and become final raster pixels.',
    title: '6. Shade fragments into pixels',
    description: 'The fragment shader interpolates attributes across the triangle, computes a color, and writes those colors into the framebuffer.',
    input: 'Covered fragments with barycentric weights.',
    output: 'A raster image made from colored pixels.',
    visualTitle: 'Final raster image',
    badge: 'Pixels written',
    inputData: 'fragment.pixel\nfragment.weights = (wA, wB, wC)\ncorner colors = red, blue, gold',
    operationData: 'color = wA×red + wB×blue + wC×gold\ndepth test\nwrite framebuffer[pixel]',
    outputData: 'framebuffer color grid\nsmall discrete pixels approximate the original triangle'
  }
];

let currentStep = 0;
let playing = false;
let timer = null;

const modelTriangle = [
  { x: -0.68, y: -0.52, color: '#fb7185' },
  { x: 0.60, y: -0.42, color: '#60a5fa' },
  { x: -0.12, y: 0.66, color: '#fbbf24' }
];

const transformedTriangle = [
  { x: -0.48, y: -0.32, color: '#fb7185' },
  { x: 0.55, y: -0.18, color: '#60a5fa' },
  { x: -0.03, y: 0.58, color: '#fbbf24' }
];

const clippedPolygon = [
  { x: -0.48, y: -0.32, color: '#fb7185' },
  { x: 0.55, y: -0.18, color: '#60a5fa' },
  { x: 0.22, y: 0.26, color: '#b6b8c6' },
  { x: -0.03, y: 0.58, color: '#fbbf24' }
];

function ndcToCanvas(point) {
  return {
    x: canvas.width * (0.5 + point.x * 0.32),
    y: canvas.height * (0.56 - point.y * 0.34),
    color: point.color
  };
}

function clear() {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#0b1728');
  gradient.addColorStop(1, '#07101d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawViewport() {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(110, 60, 540, 380);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(168,186,211,0.76)';
  ctx.font = '700 15px system-ui';
  ctx.fillText('visible viewport', 126, 88);
  ctx.restore();
}

function drawTriangle(points, options = {}) {
  const screen = points.map(ndcToCanvas);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(screen[0].x, screen[0].y);
  screen.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  if (options.fill) {
    const fill = ctx.createLinearGradient(240, 150, 520, 390);
    fill.addColorStop(0, 'rgba(251,113,133,0.38)');
    fill.addColorStop(0.55, 'rgba(251,191,36,0.34)');
    fill.addColorStop(1, 'rgba(96,165,250,0.38)');
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = options.stroke || '#5eead4';
  ctx.lineWidth = options.lineWidth || 4;
  ctx.stroke();

  screen.forEach((point, index) => {
    ctx.beginPath();
    ctx.fillStyle = point.color;
    ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#edf5ff';
    ctx.font = '800 16px system-ui';
    ctx.fillText(['A', 'B', 'C', 'D'][index], point.x + 12, point.y - 10);
  });
  ctx.restore();
}

function drawAxes() {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 86);
  ctx.lineTo(canvas.width / 2, 444);
  ctx.moveTo(132, canvas.height / 2);
  ctx.lineTo(628, canvas.height / 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(237,245,255,0.65)';
  ctx.font = '700 14px system-ui';
  ctx.fillText('continuous vector space', 132, 468);
  ctx.restore();
}

function drawGrid() {
  const grid = getGrid();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= grid.cols; x += 1) {
    ctx.beginPath();
    ctx.moveTo(grid.left + x * grid.cell, grid.top);
    ctx.lineTo(grid.left + x * grid.cell, grid.top + grid.rows * grid.cell);
    ctx.stroke();
  }
  for (let y = 0; y <= grid.rows; y += 1) {
    ctx.beginPath();
    ctx.moveTo(grid.left, grid.top + y * grid.cell);
    ctx.lineTo(grid.left + grid.cols * grid.cell, grid.top + y * grid.cell);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(168,186,211,0.78)';
  ctx.font = '700 14px system-ui';
  ctx.fillText('18 × 12 framebuffer', grid.left, grid.top - 14);
  ctx.restore();
}

function getGrid() {
  return { left: 110, top: 78, cols: 18, rows: 12, cell: 30 };
}

function gridPoint(point) {
  const grid = getGrid();
  return {
    x: grid.left + ((point.x + 1) / 2) * grid.cols * grid.cell,
    y: grid.top + ((1 - point.y) / 2) * grid.rows * grid.cell,
    color: point.color
  };
}

function pointInTriangle(px, py, triangle) {
  const [a, b, c] = triangle;
  const area = edge(a, b, c.x, c.y);
  const w0 = edge(b, c, px, py) / area;
  const w1 = edge(c, a, px, py) / area;
  const w2 = edge(a, b, px, py) / area;
  return { inside: w0 >= 0 && w1 >= 0 && w2 >= 0, weights: [w0, w1, w2] };
}

function edge(a, b, x, y) {
  return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
}

function drawGridTriangle() {
  const points = transformedTriangle.map(gridPoint);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.strokeStyle = '#5eead4';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawSamples(shaded = false) {
  const grid = getGrid();
  const triangle = transformedTriangle.map(gridPoint);
  ctx.save();
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const center = {
        x: grid.left + col * grid.cell + grid.cell / 2,
        y: grid.top + row * grid.cell + grid.cell / 2
      };
      const sample = pointInTriangle(center.x, center.y, triangle);
      if (sample.inside) {
        if (shaded) {
          const [wa, wb, wc] = sample.weights;
          const r = Math.round(251 * wa + 96 * wb + 251 * wc);
          const g = Math.round(113 * wa + 165 * wb + 191 * wc);
          const b = Math.round(133 * wa + 250 * wb + 36 * wc);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(grid.left + col * grid.cell + 2, grid.top + row * grid.cell + 2, grid.cell - 4, grid.cell - 4);
        } else {
          ctx.fillStyle = 'rgba(94,234,212,0.32)';
          ctx.fillRect(grid.left + col * grid.cell + 3, grid.top + row * grid.cell + 3, grid.cell - 6, grid.cell - 6);
          ctx.fillStyle = '#5eead4';
          ctx.beginPath();
          ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (!shaded) {
        ctx.fillStyle = 'rgba(255,255,255,0.34)';
        ctx.beginPath();
        ctx.arc(center.x, center.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawClipScene() {
  drawViewport();
  drawTriangle([
    { x: -0.7, y: -0.45, color: '#fb7185' },
    { x: 0.76, y: -0.25, color: '#60a5fa' },
    { x: 0.18, y: 0.92, color: '#fbbf24' }
  ], { stroke: 'rgba(244,114,182,0.48)', lineWidth: 3 });
  ctx.save();
  ctx.globalAlpha = 0.9;
  drawTriangle(clippedPolygon, { fill: true, stroke: '#5eead4', lineWidth: 5 });
  ctx.restore();
}

function render() {
  clear();
  if (currentStep < 3) {
    drawAxes();
  }
  if (currentStep === 0) {
    drawTriangle(modelTriangle, { fill: true });
  } else if (currentStep === 1) {
    drawTriangle(modelTriangle, { stroke: 'rgba(255,255,255,0.25)', lineWidth: 2 });
    drawTriangle(transformedTriangle, { fill: true });
  } else if (currentStep === 2) {
    drawClipScene();
  } else if (currentStep === 3) {
    drawGrid();
    drawGridTriangle();
  } else if (currentStep === 4) {
    drawGrid();
    drawSamples(false);
    drawGridTriangle();
  } else if (currentStep === 5) {
    drawGrid();
    drawSamples(true);
    drawGridTriangle();
  }
}

function updateStage(step) {
  currentStep = step;
  const stage = stages[currentStep];
  labels.stageCount.textContent = `Step ${currentStep + 1} of ${stages.length}`;
  labels.stageName.textContent = stage.name;
  labels.stageMini.textContent = stage.mini;
  labels.title.textContent = stage.title;
  labels.description.textContent = stage.description;
  labels.input.textContent = stage.input;
  labels.output.textContent = stage.output;
  labels.visualTitle.textContent = stage.visualTitle;
  labels.visualBadge.textContent = stage.badge;
  labels.inputData.textContent = stage.inputData;
  labels.operationData.textContent = stage.operationData;
  labels.outputData.textContent = stage.outputData;
  stepButtons.forEach((button, index) => button.classList.toggle('active', index === currentStep));
  prevButton.disabled = currentStep === 0;
  nextButton.disabled = currentStep === stages.length - 1;
  render();
}

function stopPlayback() {
  playing = false;
  playButton.textContent = 'Play animation';
  clearInterval(timer);
  timer = null;
}

function startPlayback() {
  playing = true;
  playButton.textContent = 'Pause animation';
  timer = setInterval(() => {
    const next = currentStep === stages.length - 1 ? 0 : currentStep + 1;
    updateStage(next);
  }, Number(speed.value));
}

stepButtons.forEach((button) => {
  button.addEventListener('click', () => {
    stopPlayback();
    updateStage(Number(button.dataset.step));
  });
});

prevButton.addEventListener('click', () => {
  stopPlayback();
  updateStage(Math.max(0, currentStep - 1));
});

nextButton.addEventListener('click', () => {
  stopPlayback();
  updateStage(Math.min(stages.length - 1, currentStep + 1));
});

playButton.addEventListener('click', () => {
  if (playing) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

speed.addEventListener('input', () => {
  if (playing) {
    stopPlayback();
    startPlayback();
  }
});

updateStage(0);

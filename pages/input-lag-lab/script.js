(() => {
  "use strict";

  const STORAGE_KEY = "input-lag-lab:v1";
  const DEFAULT_SETTINGS = { minDelay: 1500, maxDelay: 4500 };
  const els = {
    pad: document.querySelector("#reaction-pad"),
    padIcon: document.querySelector("#pad-icon"),
    padKicker: document.querySelector("#pad-kicker"),
    padTitle: document.querySelector("#pad-title"),
    padHint: document.querySelector("#pad-hint"),
    trialCounter: document.querySelector("#trial-counter"),
    select: document.querySelector("#dataset-select"),
    name: document.querySelector("#dataset-name"),
    rename: document.querySelector("#rename-dataset"),
    minDelay: document.querySelector("#delay-min"),
    maxDelay: document.querySelector("#delay-max"),
    activeMean: document.querySelector("#active-mean"),
    activeMedian: document.querySelector("#active-median"),
    activeCount: document.querySelector("#active-count"),
    grid: document.querySelector("#dataset-grid"),
    newDataset: document.querySelector("#new-dataset"),
    newDialog: document.querySelector("#new-dataset-dialog"),
    newForm: document.querySelector("#new-dataset-form"),
    newName: document.querySelector("#new-dataset-name"),
    cancelDialog: document.querySelector("#cancel-dialog"),
    deleteDataset: document.querySelector("#delete-dataset"),
    clearResults: document.querySelector("#clear-results"),
    exportCsv: document.querySelector("#export-csv")
  };

  let state = loadState();
  let phase = "idle";
  let timer = null;
  let readyAt = 0;

  function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeDataset(name) {
    return { id: newId(), name, createdAt: new Date().toISOString(), results: [] };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.datasets?.length) {
        return {
          datasets: saved.datasets,
          activeId: saved.datasets.some(dataset => dataset.id === saved.activeId) ? saved.activeId : saved.datasets[0].id,
          settings: { ...DEFAULT_SETTINGS, ...saved.settings }
        };
      }
    } catch (error) {
      console.warn("Could not load saved reaction data", error);
    }
    const starter = makeDataset("Default setup");
    return { datasets: [starter], activeId: starter.id, settings: { ...DEFAULT_SETTINGS } };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function activeDataset() {
    return state.datasets.find(dataset => dataset.id === state.activeId) || state.datasets[0];
  }

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p;
    const low = Math.floor(index);
    const fraction = index - low;
    return sorted[low + 1] === undefined ? sorted[low] : sorted[low] + fraction * (sorted[low + 1] - sorted[low]);
  }

  function summarize(results) {
    const values = results.map(result => result.ms).sort((a, b) => a - b);
    let lower = -Infinity;
    let upper = Infinity;

    if (values.length >= 4) {
      const q1 = percentile(values, .25);
      const q3 = percentile(values, .75);
      const iqr = q3 - q1;
      lower = q1 - 1.5 * iqr;
      upper = q3 + 1.5 * iqr;
    }

    const included = values.filter(value => value >= lower && value <= upper);
    const outlierValues = new Set(values.filter(value => value < lower || value > upper));
    const mean = included.length ? included.reduce((sum, value) => sum + value, 0) / included.length : null;
    const median = percentile(included, .5);
    return { included, outlierValues, mean, median };
  }

  function formatMs(value) {
    return value == null ? "—" : `${Math.round(value)} ms`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
  }

  function setPad(nextPhase, result = null) {
    phase = nextPhase;
    els.pad.className = `reaction-pad is-${nextPhase}`;
    const content = {
      idle: ["↗", "Ready to measure?", "Click to start", "Wait for green, then react as quickly as you can."],
      waiting: ["…", "Get ready", "Wait for green", "Clicking now will count as a false start."],
      ready: ["!", "Now", "Click!", "React as quickly as you can."],
      "too-soon": ["×", "False start", "Too soon", "Click to try that trial again."],
      result: ["✓", "Reaction recorded", `${result} ms`, "Click to run the next trial."]
    }[nextPhase];
    [els.padIcon.textContent, els.padKicker.textContent, els.padTitle.textContent, els.padHint.textContent] = content;
  }

  function beginWaiting() {
    syncSettings();
    const span = state.settings.maxDelay - state.settings.minDelay;
    const delay = state.settings.minDelay + Math.random() * span;
    setPad("waiting");
    timer = window.setTimeout(() => {
      timer = null;
      readyAt = performance.now();
      setPad("ready");
    }, delay);
  }

  function handleReaction() {
    if (phase === "waiting") {
      window.clearTimeout(timer);
      timer = null;
      setPad("too-soon");
      return;
    }
    if (phase === "ready") {
      const elapsed = Math.max(0, Math.round(performance.now() - readyAt));
      activeDataset().results.push({ ms: elapsed, recordedAt: new Date().toISOString() });
      saveState();
      setPad("result", elapsed);
      render();
      return;
    }
    beginWaiting();
  }

  function syncSettings() {
    let min = Math.min(9000, Math.max(500, Number(els.minDelay.value) || DEFAULT_SETTINGS.minDelay));
    let max = Math.min(10000, Math.max(600, Number(els.maxDelay.value) || DEFAULT_SETTINGS.maxDelay));
    if (max <= min) max = Math.min(10000, min + 100);
    if (min >= max) min = Math.max(500, max - 100);
    state.settings = { minDelay: min, maxDelay: max };
    els.minDelay.value = min;
    els.maxDelay.value = max;
    saveState();
  }

  function render() {
    const active = activeDataset();
    const summary = summarize(active.results);
    els.select.innerHTML = state.datasets.map(dataset => `<option value="${dataset.id}"${dataset.id === state.activeId ? " selected" : ""}>${escapeHtml(dataset.name)}</option>`).join("");
    els.name.value = active.name;
    els.minDelay.value = state.settings.minDelay;
    els.maxDelay.value = state.settings.maxDelay;
    els.activeMean.textContent = formatMs(summary.mean);
    els.activeMedian.textContent = formatMs(summary.median);
    els.activeCount.textContent = String(summary.included.length);
    els.trialCounter.textContent = active.results.length ? `${active.results.length} trial${active.results.length === 1 ? "" : "s"}` : "No trials yet";

    els.grid.innerHTML = state.datasets.map(dataset => {
      const stats = summarize(dataset.results);
      const chips = dataset.results.slice().reverse().map(result => {
        const isOutlier = stats.outlierValues.has(result.ms);
        return `<span class="trial-chip${isOutlier ? " is-outlier" : ""}" title="${isOutlier ? "Excluded outlier" : "Included result"}">${result.ms}</span>`;
      }).join("");
      return `<article class="dataset-card${dataset.id === state.activeId ? " is-active" : ""}">
        <p class="card-label">${dataset.id === state.activeId ? "Active dataset" : `${dataset.results.length} trial${dataset.results.length === 1 ? "" : "s"}`}</p>
        <h3>${escapeHtml(dataset.name)}</h3>
        <div class="card-stats">
          <div class="card-stat"><span>Mean</span><strong>${formatMs(stats.mean)}</strong></div>
          <div class="card-stat"><span>Median</span><strong>${formatMs(stats.median)}</strong></div>
        </div>
        <div class="trial-list" aria-label="Raw results in milliseconds">${chips || '<span class="trial-chip">No results yet</span>'}</div>
      </article>`;
    }).join("") || '<div class="empty-card">Create a dataset to begin testing.</div>';
  }

  function createDataset(name) {
    const dataset = makeDataset(name.trim() || `Experiment ${state.datasets.length + 1}`);
    state.datasets.push(dataset);
    state.activeId = dataset.id;
    saveState();
    resetPad();
    render();
  }

  function resetPad() {
    if (timer) window.clearTimeout(timer);
    timer = null;
    setPad("idle");
  }

  function exportCsv() {
    const rows = [["dataset", "reaction_ms", "included_in_summary", "recorded_at"]];
    state.datasets.forEach(dataset => {
      const stats = summarize(dataset.results);
      dataset.results.forEach(result => rows.push([
        dataset.name,
        result.ms,
        stats.outlierValues.has(result.ms) ? "no" : "yes",
        result.recordedAt
      ]));
    });
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `input-lag-lab-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  els.pad.addEventListener("pointerdown", event => {
    event.preventDefault();
    handleReaction();
  });
  els.pad.addEventListener("keydown", event => {
    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      handleReaction();
    }
  });
  els.select.addEventListener("change", () => {
    state.activeId = els.select.value;
    saveState();
    resetPad();
    render();
  });
  els.rename.addEventListener("click", () => {
    const name = els.name.value.trim();
    if (!name) return els.name.focus();
    activeDataset().name = name;
    saveState();
    render();
  });
  els.name.addEventListener("keydown", event => {
    if (event.key === "Enter") els.rename.click();
  });
  els.minDelay.addEventListener("change", syncSettings);
  els.maxDelay.addEventListener("change", syncSettings);
  els.newDataset.addEventListener("click", () => {
    els.newForm.reset();
    els.newDialog.showModal();
    requestAnimationFrame(() => els.newName.focus());
  });
  els.cancelDialog.addEventListener("click", () => els.newDialog.close());
  els.newForm.addEventListener("submit", event => {
    event.preventDefault();
    createDataset(els.newName.value);
    els.newDialog.close();
  });
  els.deleteDataset.addEventListener("click", () => {
    const dataset = activeDataset();
    if (!window.confirm(`Delete “${dataset.name}” and all of its trials?`)) return;
    state.datasets = state.datasets.filter(item => item.id !== dataset.id);
    if (!state.datasets.length) state.datasets.push(makeDataset("Default setup"));
    state.activeId = state.datasets[0].id;
    saveState();
    resetPad();
    render();
  });
  els.clearResults.addEventListener("click", () => {
    const dataset = activeDataset();
    if (!dataset.results.length || !window.confirm(`Clear every result from “${dataset.name}”?`)) return;
    dataset.results = [];
    saveState();
    resetPad();
    render();
  });
  els.exportCsv.addEventListener("click", exportCsv);

  render();
})();

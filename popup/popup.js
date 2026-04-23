// ============================================================
// Quimera Chess — Popup Script (popup.js) v1.18.1
// Settings management and UI interaction
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // ── Element References ───────────────────────────────────
  const analyzeForRadios = document.querySelectorAll('input[name="analyze-for"]');

  const eloSlider     = document.getElementById('elo-slider');
  const eloValue      = document.getElementById('elo-value');
  const limitStrength = document.getElementById('limit-strength');
  const eloRow        = document.getElementById('elo-row');

  const hashSlider = document.getElementById('hash-slider');
  const hashValue  = document.getElementById('hash-value');

  const searchModeRadios   = document.querySelectorAll('input[name="search-mode"]');
  const searchValueInput   = document.getElementById('search-value');
  const searchValueLabel   = document.getElementById('search-value-label');
  const searchValueDisplay = document.getElementById('search-value-display');

  const multipvSlider = document.getElementById('multipv-slider');
  const multipvValue  = document.getElementById('multipv-value');

  const animationsToggle = document.getElementById('animations');
  const evalBarToggle    = document.getElementById('show-eval-bar');

  const btnAnalyze = document.getElementById('btn-analyze');
  const btnStop    = document.getElementById('btn-stop');
  const statusBar  = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');

  // Engine overlay
  const engineLabel     = document.getElementById('header-engine-label');
  const engineOverlay   = document.getElementById('engine-overlay');
  const engineBackdrop  = document.getElementById('engine-overlay-backdrop');
  const engineClose     = document.getElementById('engine-overlay-close');
  const engineCards     = document.querySelectorAll('.engine-card');

  const ENGINE_LABELS = {
    sf16: 'v1.18.3 \u00a0\u00b7\u00a0 Stockfish 16 \u00b7 NNUE/\u03b1\u03b2 \u00b7 WASM-ST',
    sf18lite: 'v1.18.3 \u00a0\u00b7\u00a0 Stockfish 18 Lite \u00b7 WASM-ST'
  };

  // ── Load Config ──────────────────────────────────────────
  let config = {};
  try {
    const resp = await chrome.runtime.sendMessage({ target: 'background', type: 'get-config' });
    if (resp && resp.config) config = resp.config;
  } catch (e) {
    console.error('[Popup] Failed to load config:', e);
  }

  applyConfigToUI(config);

  // ── UI Updaters ──────────────────────────────────────────
  function applyConfigToUI(c) {
    // Analyze For
    const analyzeFor = c.analyzeFor || 'both';
    const afRadio = document.querySelector(`input[name="analyze-for"][value="${analyzeFor}"]`);
    if (afRadio) afRadio.checked = true;

    // Limit Strength
    const isLimited = c.limitStrength === true;
    limitStrength.checked = isLimited;
    eloRow.style.display = isLimited ? '' : 'none';
    const elo = c.elo || 2300;
    eloSlider.value = elo;
    eloValue.textContent = elo;

    // Hash
    const hash = c.hashMB || 4;
    hashSlider.value = hash;
    hashValue.textContent = hash;

    // Search Mode
    const mode = c.searchMode || 'depth';
    const modeRadio = document.querySelector(`input[name="search-mode"][value="${mode}"]`);
    if (modeRadio) modeRadio.checked = true;
    const val = c.searchValue || 20;
    searchValueInput.value = val;
    searchValueDisplay.textContent = val;
    updateSearchLabel(mode);

    // MultiPV
    const mpv = c.multiPV || 3;
    multipvSlider.value = mpv;
    multipvValue.textContent = mpv;

    // Animations
    animationsToggle.checked = c.animations !== false;

    // Eval Bar
    evalBarToggle.checked = c.showEvalBar !== false;

    // Engine selection
    const eid = c.engineId || 'sf16';
    engineLabel.textContent = ENGINE_LABELS[eid] || ENGINE_LABELS.sf16;
    engineCards.forEach(card => {
      card.classList.toggle('selected', card.dataset.engine === eid);
    });

    updateStatus(c.analysisActive);
    updateButtons(c.analysisActive);
  }

  function updateSearchLabel(mode) {
    const labels = { depth: 'Depth', movetime: 'Time (ms)', nodes: 'Nodes' };
    searchValueLabel.textContent = labels[mode] || 'Value';
  }

  function updateStatus(active) {
    statusBar.className = 'status-bar' + (active ? ' active' : '');
    statusText.textContent = active ? 'Active' : 'Inactive';
  }

  function updateButtons(active) {
    btnAnalyze.style.display = active ? 'none' : 'flex';
    btnStop.style.display    = active ? 'flex'  : 'none';
  }

  // ── Save Config ──────────────────────────────────────────
  let saveTimer = null;

  async function saveConfig(updates) {
    try {
      const resp = await chrome.runtime.sendMessage({
        target: 'background',
        type: 'set-config',
        updates: updates
      });
      if (resp && resp.config) config = resp.config;
    } catch (e) {
      console.error('[Popup] Failed to save config:', e);
    }
  }

  function saveConfigDebounced(updates, delay = 300) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveConfig(updates), delay);
  }

  // ── Event Listeners ──────────────────────────────────────

  // Analyze For
  analyzeForRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      saveConfig({ analyzeFor: radio.value });
    });
  });

  // Limit Strength toggle
  limitStrength.addEventListener('change', () => {
    const isChecked = limitStrength.checked;
    eloRow.style.display = isChecked ? '' : 'none';
    // Auto-force MultiPV to 1 when enabling (incompatible with MultiPV > 1)
    if (isChecked && parseInt(multipvSlider.value) > 1) {
      multipvSlider.value = 1;
      multipvValue.textContent = 1;
      saveConfig({ limitStrength: true, multiPV: 1 });
    } else {
      saveConfig({ limitStrength: isChecked });
    }
  });

  // ELO slider
  eloSlider.addEventListener('input', () => {
    eloValue.textContent = eloSlider.value;
  });
  eloSlider.addEventListener('change', () => {
    saveConfig({ elo: parseInt(eloSlider.value) });
  });

  // Hash slider
  hashSlider.addEventListener('input', () => {
    hashValue.textContent = hashSlider.value;
  });
  hashSlider.addEventListener('change', () => {
    saveConfig({ hashMB: parseInt(hashSlider.value) });
  });

  // Search Mode
  searchModeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const mode = radio.value;
      updateSearchLabel(mode);
      const defaults = { depth: 20, movetime: 3000, nodes: 1000000 };
      const defVal = defaults[mode];
      searchValueInput.value = defVal;
      searchValueDisplay.textContent = defVal;
      saveConfig({ searchMode: mode, searchValue: defVal });
    });
  });

  searchValueInput.addEventListener('input', () => {
    const v = parseInt(searchValueInput.value);
    if (!isNaN(v) && v > 0) {
      searchValueDisplay.textContent = v;
      saveConfigDebounced({ searchValue: v });
    }
  });

  // MultiPV — auto-disable limit strength if > 1
  multipvSlider.addEventListener('input', () => {
    multipvValue.textContent = multipvSlider.value;
  });
  multipvSlider.addEventListener('change', () => {
    const mpv = parseInt(multipvSlider.value);
    if (mpv > 1 && limitStrength.checked) {
      limitStrength.checked = false;
      eloRow.style.display = 'none';
      saveConfig({ multiPV: mpv, limitStrength: false });
    } else {
      saveConfig({ multiPV: mpv });
    }
  });

  // Animations
  animationsToggle.addEventListener('change', () => {
    saveConfig({ animations: animationsToggle.checked });
  });

  // Eval Bar
  evalBarToggle.addEventListener('change', () => {
    saveConfig({ showEvalBar: evalBarToggle.checked });
  });

  // ── Engine Selector Overlay ─────────────────────────────
  engineLabel.addEventListener('click', () => {
    engineOverlay.classList.add('open');
  });

  engineBackdrop.addEventListener('click', () => {
    engineOverlay.classList.remove('open');
  });

  engineClose.addEventListener('click', () => {
    engineOverlay.classList.remove('open');
  });

  engineCards.forEach(card => {
    card.addEventListener('click', async () => {
      const eid = card.dataset.engine;
      if (eid === config.engineId) {
        engineOverlay.classList.remove('open');
        return;
      }
      // Update UI immediately
      engineCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      engineLabel.textContent = ENGINE_LABELS[eid] || ENGINE_LABELS.sf16;
      // Save and broadcast
      await saveConfig({ engineId: eid });
      engineOverlay.classList.remove('open');
    });
  });

  // ── Action Buttons ───────────────────────────────────────
  btnAnalyze.addEventListener('click', async () => {
    await saveConfig({ analysisActive: true });
    updateStatus(true);
    updateButtons(true);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        target: 'content',
        type: 'toggle-analysis',
        active: true
      }).catch(() => {});
    }
  });

  btnStop.addEventListener('click', async () => {
    await saveConfig({ analysisActive: false });
    updateStatus(false);
    updateButtons(false);

    chrome.runtime.sendMessage({ target: 'background', type: 'stop-analysis' });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        target: 'content',
        type: 'toggle-analysis',
        active: false
      }).catch(() => {});
    }
  });
});

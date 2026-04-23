// ============================================================
// Quimera Chess — Offscreen Document (offscreen.js) v1.18.3
// Multi-engine state machine with bullet-optimized pipeline.
// Supports: sf16 (Stockfish 16 NNUE), sf18lite (Stockfish 18 Lite)
// ============================================================

// ── Engine Registry ────────────────────────────────────────────
// Maps engineId → worker JS file path.
// Both engines use standard UCI over Web Worker postMessage.
const ENGINE_REGISTRY = {
  sf16: {
    js: 'stockfish/stockfish-nnue-16-single.js',
    label: 'Stockfish 16 · NNUE/αβ · WASM-ST'
  },
  sf18lite: {
    js: 'stockfish/stockfish-18-lite-single.js',
    label: 'Stockfish 18 Lite · WASM-ST'
  }
};

// ── State ──────────────────────────────────────────────────────
let stockfish = null;
let currentTabId = null;
let analysisResults = {};
let isAnalyzing = false;
let engineReady = false;
let pendingAnalysis = null;   // queued while engine is busy
let currentFen = null;        // FEN currently being analyzed
let lastConfig = {};          // last config used (for crash recovery)
let safetyTimer = null;       // kills a truly stuck engine
let stopTimer = null;         // waits for bestmove after stop
let lastInfoMs = 0;           // throttle for live updates
let currentHashMB = 4;        // MB — applied on uciok
let currentSearchMode = 'depth';
let currentSearchValue = 20;
let activeEngineId = 'sf16';  // which engine worker is currently loaded
let pendingGo = null;         // deferred position+go (phase 2 of analysis)

// ── Initialize Engine Worker ───────────────────────────────────
function initStockfish(engineId) {
  // Kill existing worker cleanly
  if (stockfish) {
    try { stockfish.terminate(); } catch (e) {}
    stockfish = null;
  }
  clearTimeout(safetyTimer);
  clearTimeout(stopTimer);
  engineReady = false;
  isAnalyzing = false;

  // Resolve engine ID — fall back to sf16 if unknown
  const resolvedId = ENGINE_REGISTRY[engineId] ? engineId : 'sf16';
  activeEngineId = resolvedId;
  const entry = ENGINE_REGISTRY[resolvedId];

  const workerUrl = chrome.runtime.getURL(entry.js);
  try {
    stockfish = new Worker(workerUrl);
  } catch (e) {
    console.error('[Offscreen] Cannot create worker:', e);
    return;
  }

  stockfish.addEventListener('message', (e) => handleOutput(e.data));

  stockfish.addEventListener('error', (e) => {
    console.error('[Offscreen] Worker crashed:', e);
    try { stockfish.terminate(); } catch (err) {}
    stockfish = null;
    engineReady = false;
    clearTimeout(safetyTimer);
    clearTimeout(stopTimer);

    // Capture FEN BEFORE clearing, so crash recovery can re-queue
    const fenAtCrash = currentFen;
    currentFen = null;
    isAnalyzing = false;

    if (!pendingAnalysis && fenAtCrash && currentTabId) {
      pendingAnalysis = { fen: fenAtCrash, config: lastConfig, tabId: currentTabId };
      console.warn('[Offscreen] Auto-queued crash recovery for:', fenAtCrash.slice(0, 30));
    }

    // Restart same engine
    initStockfish(activeEngineId);
  });

  sendUCI('uci');
}

function sendUCI(cmd) {
  if (!stockfish) return;
  try {
    stockfish.postMessage(cmd);
  } catch (e) {
    console.error('[Offscreen] postMessage failed:', cmd, e);
    try { stockfish.terminate(); } catch (err) {}
    stockfish = null;
    engineReady = false;
    isAnalyzing = false;
  }
}

// ── UCI Output Handler ─────────────────────────────────────────
function handleOutput(line) {
  if (typeof line !== 'string') return;

  if (line === 'uciok') {
    sendUCI(`setoption name Hash value ${currentHashMB}`);
    sendUCI('setoption name Threads value 1');
    sendUCI('isready');
    return;
  }

  if (line === 'readyok') {
    engineReady = true;
    // Phase 2 of analysis: engine is synced, now send position + go
    if (pendingGo) {
      const { fen, goCmd, effectiveMode, effectiveValue, safetyMs } = pendingGo;
      pendingGo = null;

      sendUCI(`position fen ${fen}`);
      console.log(`[Offscreen] [${activeEngineId}] ${goCmd} | ${fen.split(' ').slice(0, 2).join(' ')}`);
      sendUCI(goCmd);

      // Safety timer
      clearTimeout(safetyTimer);
      safetyTimer = setTimeout(() => {
        if (isAnalyzing) {
          console.warn('[Offscreen] Safety timeout — restarting engine');
          if (Object.keys(analysisResults).length > 0) sendResults(true);
          initStockfish(activeEngineId);
        }
      }, safetyMs);
    } else {
      console.log(`[Offscreen] Engine ready (${activeEngineId})`);
      flushPending();
    }
    return;
  }

  if (line.startsWith('info')) {
    if (line.includes(' pv ')) {
      parseInfo(line);
    }
    // Live update throttle:
    // Bullet (movetime ≤ 2000ms or low depth ≤8): 80ms for instant arrow updates.
    // Normal searches: 400ms avoids flooding the message bus.
    const isFast = (currentSearchMode === 'movetime' && currentSearchValue <= 2000) ||
                   (currentSearchMode === 'depth' && currentSearchValue <= 8);
    const throttleMs = isFast ? 80 : 400;
    const now = Date.now();
    if (now - lastInfoMs > throttleMs && Object.keys(analysisResults).length > 0) {
      lastInfoMs = now;
      sendResults(false);
    }
    return;
  }

  if (line.startsWith('bestmove')) {
    clearTimeout(safetyTimer);
    clearTimeout(stopTimer);
    isAnalyzing = false;
    currentFen = null;

    const resultsToSend = Object.keys(analysisResults).length > 0
      ? { ...analysisResults }
      : null;

    sendResultsFinal(resultsToSend, line.split(' ')[1]);
    flushPending();
  }
}

// ── Send results to content script ─────────────────────────────
function sendResults(isFinal) {
  try {
    chrome.runtime.sendMessage({
      target: 'content',
      tabId: currentTabId,
      type: 'analysis-result',
      results: { ...analysisResults },
      isFinal: isFinal
    });
  } catch (e) { /* tab may be closed */ }
}

function sendResultsFinal(results, bestMove) {
  try {
    chrome.runtime.sendMessage({
      target: 'content',
      tabId: currentTabId,
      type: 'analysis-result',
      results: results,
      bestMove: bestMove,
      isFinal: true
    });
  } catch (e) {}
}

// ── Parse UCI Info Line ────────────────────────────────────────
function parseInfo(line) {
  const tokens = line.split(' ');
  let depth = 0, multiPV = 1, score = 0, scoreType = 'cp';
  let pv = [], nodes = 0, nps = 0;

  for (let i = 0; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'depth':    depth = parseInt(tokens[++i]); break;
      case 'multipv':  multiPV = parseInt(tokens[++i]); break;
      case 'score':    scoreType = tokens[++i]; score = parseInt(tokens[++i]); break;
      case 'nodes':    nodes = parseInt(tokens[++i]); break;
      case 'nps':      nps = parseInt(tokens[++i]); break;
      case 'pv':       pv = tokens.slice(i + 1); i = tokens.length; break;
    }
  }

  if (pv.length > 0) {
    analysisResults[multiPV] = { depth, multiPV, score, scoreType, pv, nodes, nps };
  }
}

// ── Flush Pending Analysis ─────────────────────────────────────
function flushPending() {
  if (!pendingAnalysis) return;
  if (!engineReady) return;
  if (isAnalyzing) return;

  const { fen, config, tabId } = pendingAnalysis;
  pendingAnalysis = null;
  executeAnalysis(fen, config, tabId);
}

// ── Message Handler ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'analyze':
      // Read hash size from config
      if (message.config && message.config.hashMB) {
        currentHashMB = Math.max(2, Math.min(32, parseInt(message.config.hashMB) || 4));
      }

      // Check if engine needs switching
      const requestedEngine = (message.config && message.config.engineId) || 'sf16';
      if (requestedEngine !== activeEngineId) {
        // Switch engine: terminate current, start new, queue analysis
        pendingAnalysis = { fen: message.fen, config: message.config, tabId: message.tabId };
        initStockfish(requestedEngine);
        return; // flushPending() fires on readyok
      }

      startAnalysis(message.fen, message.config, message.tabId);
      break;
    case 'stop':
      stopAnalysis();
      break;
    case 'ping':
      sendResponse({ status: 'alive', engineReady, isAnalyzing, activeEngineId });
      break;
  }
});

// ── Start Analysis ─────────────────────────────────────────────
function startAnalysis(fen, config, tabId) {
  pendingAnalysis = { fen, config, tabId };

  if (!stockfish) {
    const engineId = (config && config.engineId) || 'sf16';
    initStockfish(engineId);
    return;
  }

  if (!engineReady) {
    return;
  }

  if (isAnalyzing) {
    sendUCI('stop');
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      console.warn('[Offscreen] Stop timeout — hard restarting engine');
      initStockfish(activeEngineId);
    }, 1200); // Reduced from 1500ms for faster bullet recovery
    return;
  }

  const pending = pendingAnalysis;
  pendingAnalysis = null;
  executeAnalysis(pending.fen, pending.config, pending.tabId);
}

// ── ELO → Strength Profile ─────────────────────────────────────
function eloToStrengthProfile(elo) {
  const clamped = Math.max(1100, Math.min(3600, elo));
  const t = (clamped - 1100) / (3600 - 1100);
  const skillLevel = Math.round(t * 20);
  const maxDepth = Math.round(5 + t * 19);
  return { skillLevel, maxDepth };
}

// ── Execute Analysis ───────────────────────────────────────────
function executeAnalysis(fen, config, tabId) {
  currentTabId = tabId;
  currentFen = fen;
  lastConfig = config;
  analysisResults = {};
  isAnalyzing = true;
  lastInfoMs = 0;

  const elo = parseInt(config.elo) || 2300;
  const multiPV = parseInt(config.multiPV) || 3;
  const mode = config.searchMode || 'depth';
  const value = parseInt(config.searchValue) || 20;
  const limitStrength = config.limitStrength === true && multiPV === 1;

  let effectiveMode, effectiveValue;

  if (limitStrength) {
    const profile = eloToStrengthProfile(elo);
    effectiveMode = 'depth';
    effectiveValue = profile.maxDepth;

    sendUCI('ucinewgame');
    sendUCI(`setoption name Skill Level value ${profile.skillLevel}`);
    sendUCI('setoption name UCI_LimitStrength value true');
    sendUCI(`setoption name UCI_Elo value ${elo}`);
    sendUCI('setoption name MultiPV value 1');

    console.log(`[Offscreen] Strength limited: ELO ${elo} → Skill ${profile.skillLevel}, Depth ${profile.maxDepth}`);
  } else {
    effectiveMode = mode;
    effectiveValue = value;

    sendUCI('ucinewgame');
    sendUCI('setoption name Skill Level value 20');
    sendUCI('setoption name UCI_LimitStrength value false');
    sendUCI(`setoption name MultiPV value ${multiPV}`);
  }

  currentSearchMode = effectiveMode;
  currentSearchValue = effectiveValue;

  let goCmd;
  switch (effectiveMode) {
    case 'movetime': goCmd = `go movetime ${effectiveValue}`; break;
    case 'nodes':    goCmd = `go nodes ${effectiveValue}`; break;
    default:         goCmd = `go depth ${effectiveValue}`; break;
  }

  let safetyMs;
  switch (effectiveMode) {
    case 'movetime': safetyMs = effectiveValue * 4 + 10000; break;
    case 'nodes':    safetyMs = 120000; break;
    default:         safetyMs = Math.max(30000, effectiveValue * 6000); break;
  }

  // Phase 1: Engine is processing ucinewgame + setoptions.
  // We send 'isready' and wait for 'readyok' to proceed with Phase 2 (position + go).
  pendingGo = { fen, goCmd, effectiveMode, effectiveValue, safetyMs };
  sendUCI('isready');
}

// ── Stop Analysis ──────────────────────────────────────────────
function stopAnalysis() {
  clearTimeout(safetyTimer);
  clearTimeout(stopTimer);
  pendingAnalysis = null;

  if (isAnalyzing && stockfish) {
    sendUCI('stop');
  } else {
    isAnalyzing = false;
  }
}

// ── Boot ───────────────────────────────────────────────────────
initStockfish('sf16');

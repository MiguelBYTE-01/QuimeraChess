// ============================================================
// Quimera Chess — Content Script (content.js) v1.18.1
// Orchestrates board detection, analysis, arrow + eval bar rendering
// ============================================================

(() => {
  let isActive = false;
  let config = {};
  let boardObserver = null;
  let resizeObserver = null;
  let lastFEN = '';
  let lastAnalyzedFEN = ''; // FEN that is currently being analyzed
  let statusBadge = null;
  let lastResults = null;
  let lastFlippedState = false;

  // Debounce timer — wait for board animations to settle
  // Shorter debounce = more responsive in bullet/blitz games
  let analyzeTimer = null;
  const ANALYZE_DEBOUNCE_MS = 150; // 150ms — fast enough for bullet, enough for CSS transitions

  // Watchdog for stuck analysis
  let analysisWatchdog = null;

  // Flag to ignore our own DOM mutations
  let ignoreMutations = false;

  // Eval bar element reference
  let evalBarEl = null;

  // ── Initialize ─────────────────────────────────────────────
  async function init() {
    const site = BoardDetector.detectSite();
    if (!site) return;

    try {
      const resp = await chrome.runtime.sendMessage({ target: 'background', type: 'get-config' });
      if (resp && resp.config) config = resp.config;
    } catch (e) {
      console.error('[CSA] Failed to load config:', e);
    }

    createStatusBadge();
    setupResizeObserver();
    waitForBoard();

    console.log('[CSA] Quimera Chess initialized on', site);
  }

  // ── Wait for Board to Appear ───────────────────────────────
  function waitForBoard() {
    const board = BoardDetector.findBoard();
    if (board) {
      onBoardReady(board);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const board = BoardDetector.findBoard();
      if (board) {
        obs.disconnect();
        onBoardReady(board);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function onBoardReady(board) {
    setupBoardObserver(board);

    if (config.analysisActive) {
      isActive = true;
      // Force re-analysis when a new board is found (crucial for SPA navigation)
      lastAnalyzedFEN = '';
      lastFlippedState = BoardDetector.isFlipped();
      triggerAnalysis();
    }

    // SPA support: Chess.com replaces the board without reloading the page.
    // We must monitor if the board is removed from the DOM and wait for a new one.
    const spaCheckInterval = setInterval(() => {
      if (!document.body.contains(board)) {
        clearInterval(spaCheckInterval);
        if (boardObserver) {
          boardObserver.disconnect();
          boardObserver = null;
        }
        removeEvalBar(); // Clean up eval bar when board is removed
        waitForBoard();  // Restart the search for the new board
      }
    }, 1000);
  }

  // ── Board Mutation Observer (auto-update on move) ──────────
  function setupBoardObserver(board) {
    if (boardObserver) boardObserver.disconnect();

    const targetNode = board.parentElement || board;

    boardObserver = new MutationObserver((mutations) => {
      if (!isActive) return;

      // CRITICAL: Ignore mutations caused by our own overlay
      if (ignoreMutations) return;

      // Also filter out mutations on our own elements
      for (const mutation of mutations) {
        if (mutation.target.id === 'csa-arrow-overlay-container' ||
            mutation.target.id === 'csa-arrow-svg' ||
            mutation.target.id === 'csa-eval-bar' ||
            mutation.target.closest?.('#csa-arrow-overlay-container') ||
            mutation.target.closest?.('#csa-eval-bar')) {
          return; // This is our overlay/eval bar changing, not the board
        }
        // Check added/removed nodes
        for (const node of mutation.addedNodes) {
          if (node.id === 'csa-arrow-overlay-container' || node.id === 'csa-arrow-svg' || node.id === 'csa-eval-bar') return;
        }
        for (const node of mutation.removedNodes) {
          if (node.id === 'csa-arrow-overlay-container' || node.id === 'csa-arrow-svg' || node.id === 'csa-eval-bar') return;
        }
      }

      // Debounce: wait for board animations to complete
      if (analyzeTimer) clearTimeout(analyzeTimer);
      analyzeTimer = setTimeout(() => {
        const currentFEN = BoardDetector.extractFEN();
        if (!currentFEN) return;

        // Only re-analyze if the POSITION changed (ignore turn field for comparison)
        // FEN format: "position turn castling ..."
        const currentPosition = currentFEN.split(' ')[0];
        const lastPosition = lastFEN.split(' ')[0];
        const currentFlippedState = BoardDetector.isFlipped();

        if (currentPosition !== lastPosition) {
          // IMMEDIATELY clear stale arrows on position change.
          // This prevents "frozen arrows" during rapid play where the
          // debounced analysis hasn't fired yet.
          ignoreMutations = true;
          ArrowRenderer.clearArrows();
          lastResults = null;
          setTimeout(() => { ignoreMutations = false; }, 50);

          lastFEN = currentFEN;
          lastFlippedState = currentFlippedState;
          triggerAnalysis();
        } else if (currentFlippedState !== lastFlippedState) {
          // Board flipped without a move being made. Re-draw arrows correctly!
          lastFlippedState = currentFlippedState;
          if (lastResults) {
            ignoreMutations = true;
            ArrowRenderer.removeOverlay();
            ArrowRenderer.createOverlay();
            ArrowRenderer.drawAnalysisArrows(lastResults, config);
            updateEvalBar(lastResults);
            setTimeout(() => { ignoreMutations = false; }, 100);
          }
        }
      }, ANALYZE_DEBOUNCE_MS);
    });

    boardObserver.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'transform', 'orientation', 'data-flipped']
    });
  }

  // ── Resize Observer ────────────────────────────────────────
  function setupResizeObserver() {
    resizeObserver = new ResizeObserver(() => {
      ArrowRenderer.updatePosition();
      if (isActive && lastResults) {
        ignoreMutations = true;
        ArrowRenderer.removeOverlay();
        ArrowRenderer.createOverlay();
        ArrowRenderer.drawAnalysisArrows(lastResults, config);
        repositionEvalBar();
        setTimeout(() => { ignoreMutations = false; }, 100);
      }
    });

    const checkBoard = () => {
      const board = BoardDetector.findBoard();
      if (board) {
        resizeObserver.observe(board);
      } else {
        setTimeout(checkBoard, 1000);
      }
    };
    checkBoard();
  }

  // ── Turn Filtering ──────────────────────────────────────────
  function shouldAnalyze(fen) {
    const turnMatch = fen.match(/ (w|b) /);
    if (!turnMatch) return true;
    const turn = turnMatch[1];
    
    const analyzeFor = config.analyzeFor || 'auto';
    
    if (analyzeFor === 'both') return true;
    if (analyzeFor === 'white') return turn === 'w';
    if (analyzeFor === 'black') return turn === 'b';
    
    // Auto mode: analyze only when it's MY turn
    const flipped = BoardDetector.isFlipped();
    const mySide = flipped ? 'b' : 'w';
    return turn === mySide;
  }

  // ── Trigger Analysis ───────────────────────────────────────
  function triggerAnalysis() {
    const fen = BoardDetector.extractFEN();
    if (!fen) {
      updateBadge('No board', 'error');
      return;
    }

    // Don't re-analyze the exact same FEN that's already being analyzed
    if (fen === lastAnalyzedFEN) {
      return;
    }

    // Check if we should analyze based on the "Analyze For" setting
    if (!shouldAnalyze(fen)) {
      updateBadge('Waiting...', 'idle');
      ignoreMutations = true;
      ArrowRenderer.clearArrows();
      setTimeout(() => { ignoreMutations = false; }, 100);
      lastAnalyzedFEN = '';
      lastFEN = fen;
      chrome.runtime.sendMessage({ target: 'background', type: 'stop-analysis' });
      return;
    }

    lastFEN = fen;
    lastAnalyzedFEN = fen;
    updateBadge('Analyzing...', 'active');

    // Clear previous arrows — suppress mutation observer
    ignoreMutations = true;
    ArrowRenderer.clearArrows();
    setTimeout(() => { ignoreMutations = false; }, 100);

    // Send analyze request
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'analyze',
      fen: fen
    });

    // Safety watchdog based on search mode
    clearTimeout(analysisWatchdog);
    const watchdogTime = getWatchdogTimeout();
    analysisWatchdog = setTimeout(() => {
      if (isActive && lastAnalyzedFEN === fen) {
        console.warn('[CSA] Analysis watchdog triggered, resetting engine');
        updateBadge('Retrying...', 'active');
        lastAnalyzedFEN = '';
        chrome.runtime.sendMessage({ target: 'background', type: 'reset-engine' });
        setTimeout(() => {
          if (isActive) triggerAnalysis();
        }, 2000);
      }
    }, watchdogTime);
  }

  // Calculate watchdog timeout based on actual search parameters.
  // When limitStrength is active, the engine uses ELO-derived depth (5-24),
  // NOT the user-configured depth — so we must calculate accordingly.
  function getWatchdogTimeout() {
    const mpv = parseInt(config.multiPV) || 3;
    if (config.limitStrength && mpv === 1) {
      // ELO-derived depth: 1100→5, 3600→24. Give 6s per depth + 10s buffer.
      const elo = parseInt(config.elo) || 2300;
      const t = Math.max(0, Math.min(1, (elo - 1100) / (3600 - 1100)));
      const effectiveDepth = Math.round(5 + t * 19);
      return Math.max(15000, effectiveDepth * 6000);
    }

    const mode = config.searchMode || 'depth';
    const value = parseInt(config.searchValue) || 20;

    switch (mode) {
      case 'depth':
        // e.g. depth 20 → 60s. Engine sends live info lines, so watchdog just needs
        // to catch complete hangs, not normal long searches.
        return Math.max(30000, value * 3000);
      case 'movetime':
        // value is in MILLISECONDS. Give 3x + 5s buffer
        return value * 3 + 5000;
      case 'nodes':
        return 60000;
      default:
        return 60000;
    }
  }

  // ── Message Handler ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'content') return;

    switch (message.type) {
      case 'toggle-analysis':
        isActive = message.active;
        if (isActive) {
          ignoreMutations = true;
          ArrowRenderer.createOverlay();
          if (config.showEvalBar !== false) createEvalBar();
          setTimeout(() => { ignoreMutations = false; }, 100);
          triggerAnalysis();
          updateBadge('Active', 'active');
        } else {
          clearTimeout(analysisWatchdog);
          clearTimeout(analyzeTimer);
          ignoreMutations = true;
          ArrowRenderer.removeOverlay();
          removeEvalBar();
          setTimeout(() => { ignoreMutations = false; }, 100);
          updateBadge('Off', 'idle');
          lastFEN = '';
          lastAnalyzedFEN = '';
          lastResults = null;
          chrome.runtime.sendMessage({ target: 'background', type: 'stop-analysis' });
        }
        break;

      case 'analysis-result':
        // ALWAYS clear the watchdog — engine is alive and sending data
        clearTimeout(analysisWatchdog);

        if (isActive && message.results) {
          lastResults = message.results;

          // Only clear lastAnalyzedFEN when analysis is FINAL (bestmove received).
          // During live updates (isFinal=false), keep it set so MutationObserver
          // doesn't immediately re-trigger analysis of the same position!
          if (message.isFinal) {
            lastAnalyzedFEN = '';
          } else {
            // Re-arm watchdog with a shorter rolling window (15s of silence = hang)
            analysisWatchdog = setTimeout(() => {
              if (isActive) {
                console.warn('[CSA] Live update watchdog: engine went silent, resetting');
                lastAnalyzedFEN = '';
                chrome.runtime.sendMessage({ target: 'background', type: 'reset-engine' });
                setTimeout(() => { if (isActive) triggerAnalysis(); }, 2000);
              }
            }, 15000);
          }

          ignoreMutations = true;
          ArrowRenderer.drawAnalysisArrows(message.results, config);
          updateEvalBar(message.results);
          setTimeout(() => { ignoreMutations = false; }, 100);

          // Update badge with best move info
          const bestPV = message.results[1];
          if (bestPV && bestPV.pv && bestPV.pv.length > 0) {
            const moveStr = formatMove(bestPV.pv[0]);
            const scoreText = formatScore(bestPV.scoreType, bestPV.score);
            updateBadge(`${moveStr} ${scoreText} (d${bestPV.depth})`, 'active');
          }
        } else if (isActive && message.isFinal && message.results === null) {
          // bestmove (none) — game over (checkmate/stalemate)
          lastAnalyzedFEN = '';
          updateBadge('Game Over', 'idle');
        }
        break;

      case 'analysis-fatal-error':
        // The engine crashed repeatedly on this position (usually due to memory limits)
        clearTimeout(analysisWatchdog);
        if (isActive) {
          console.error('[CSA] Fatal Engine Error:', message.error);
          updateBadge('Crash (Lower Depth)', 'error');
          // We intentionally do NOT clear lastAnalyzedFEN here.
          // This prevents the MutationObserver from instantly re-triggering the same position!
          ignoreMutations = true;
          ArrowRenderer.clearArrows();
          setTimeout(() => { ignoreMutations = false; }, 100);
          chrome.runtime.sendMessage({ target: 'background', type: 'stop-analysis' });
        }
        break;

      case 'config-updated':
        const oldConfig = config;
        config = message.config;
        if (message.config.analysisActive !== undefined) {
          isActive = message.config.analysisActive;
        }

        const needsReanalysis = oldConfig.multiPV !== config.multiPV ||
                                oldConfig.elo !== config.elo ||
                                oldConfig.limitStrength !== config.limitStrength ||
                                oldConfig.searchMode !== config.searchMode ||
                                oldConfig.searchValue !== config.searchValue ||
                                oldConfig.analyzeFor !== config.analyzeFor ||
                                oldConfig.hashMB !== config.hashMB ||
                                oldConfig.engineId !== config.engineId;

        // Handle eval bar toggle without reanalysis
        if (oldConfig.showEvalBar !== config.showEvalBar) {
          if (config.showEvalBar && isActive) {
            createEvalBar();
            if (lastResults) updateEvalBar(lastResults);
          } else {
            removeEvalBar();
          }
        }

        if (isActive) {
          if (needsReanalysis) {
            // Restart analysis to apply new engine parameters
            lastAnalyzedFEN = '';
            triggerAnalysis();
          } else if (lastResults) {
            // Just redraw existing results (e.g. if animations changed)
            ignoreMutations = true;
            ArrowRenderer.drawAnalysisArrows(lastResults, config);
            setTimeout(() => { ignoreMutations = false; }, 100);
          }
        }
        break;

      case 'request-fen':
        const fen = BoardDetector.extractFEN();
        sendResponse({ fen: fen });
        break;
    }
  });

  // ── Score Formatting ───────────────────────────────────────
  function formatScore(type, value) {
    if (type === 'mate') return `M${value}`;
    if (type === 'cp') return (value >= 0 ? '+' : '') + (value / 100).toFixed(1);
    return '?';
  }

  // ── Move Formatting (UCI to readable) ─────────────────────
  function formatMove(uciMove) {
    if (!uciMove || uciMove.length < 4) return '??';
    const from = uciMove.substring(0, 2);
    const to   = uciMove.substring(2, 4);
    const promo = uciMove.length > 4 ? '=' + uciMove[4].toUpperCase() : '';
    return `${from}\u2192${to}${promo}`;
  }

  // ── Status Badge ───────────────────────────────────────────
  function createStatusBadge() {
    if (statusBadge) return;

    statusBadge = document.createElement('div');
    statusBadge.id = 'csa-status-badge';
    statusBadge.innerHTML = `
      <div class="csa-badge-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
          <defs>
            <linearGradient id="csaGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#FFD54F" />
              <stop offset="100%" stop-color="#F9A825" />
            </linearGradient>
            <filter id="csaGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#FFD54F" flood-opacity="0.4" />
            </filter>
          </defs>
          <path fill="url(#csaGoldGrad)" filter="url(#csaGlow)" d="M5 20h14v2H5v-2zm2-2h10v-2H7v2zm1-2h8l-1-7H9l-1 7zm-1-8h10V5h-2v2h-2V5h-2v2h-2V5H7v3z"/>
        </svg>
      </div>
      <div class="csa-badge-text">Off</div>
    `;
    statusBadge.addEventListener('click', () => {
      chrome.runtime.sendMessage({ target: 'background', type: 'toggle-analysis' });
    });

    document.body.appendChild(statusBadge);
  }

  function updateBadge(text, state) {
    if (!statusBadge) return;
    const textEl = statusBadge.querySelector('.csa-badge-text');
    if (textEl) textEl.textContent = text;

    statusBadge.className = '';
    statusBadge.id = 'csa-status-badge';
    if (state === 'active') statusBadge.classList.add('csa-active');
    else if (state === 'error') statusBadge.classList.add('csa-error');
    else statusBadge.classList.add('csa-idle');
  }

  // ══════════════════════════════════════════════════════════════
  // ── Evaluation Bar ────────────────────────────────────────────
  // A compact vertical bar alongside the board showing the engine
  // evaluation. Inspired by Chess.com's eval bar but smaller/modern.
  // ══════════════════════════════════════════════════════════════

  function createEvalBar() {
    if (evalBarEl) return; // Already exists
    const board = BoardDetector.findBoard();
    if (!board) return;

    evalBarEl = document.createElement('div');
    evalBarEl.id = 'csa-eval-bar';

    // Inner structure: white fill (bottom) and score label
    evalBarEl.innerHTML = `
      <div class="csa-eval-fill" id="csa-eval-fill"></div>
      <div class="csa-eval-label" id="csa-eval-label">0.0</div>
    `;

    // Position next to the board
    const boardParent = board.parentElement;
    if (boardParent) {
      const parentStyle = window.getComputedStyle(boardParent);
      if (parentStyle.position === 'static') {
        boardParent.style.position = 'relative';
      }
      boardParent.insertBefore(evalBarEl, board);
    }

    repositionEvalBar();
  }

  function removeEvalBar() {
    if (evalBarEl) {
      evalBarEl.remove();
      evalBarEl = null;
    }
    // Clean up any stale ones
    document.querySelectorAll('#csa-eval-bar').forEach(el => el.remove());
  }

  function repositionEvalBar() {
    if (!evalBarEl) return;
    const board = BoardDetector.findBoard();
    if (!board) return;
    const rect = board.getBoundingClientRect();
    // Bar height matches board height, positioned to the left of the board
    evalBarEl.style.height = `${rect.height}px`;
  }

  function updateEvalBar(results) {
    if (config.showEvalBar === false) return;
    if (!evalBarEl) {
      createEvalBar();
      if (!evalBarEl) return;
    }

    const bestPV = results[1];
    if (!bestPV) return;

    const fillEl = evalBarEl.querySelector('#csa-eval-fill');
    const labelEl = evalBarEl.querySelector('#csa-eval-label');
    if (!fillEl || !labelEl) return;

    let whitePercent;
    let displayText;

    if (bestPV.scoreType === 'mate') {
      const mateIn = bestPV.score;
      displayText = `M${Math.abs(mateIn)}`;
      // Mate for white = 100%, mate for black = 0%
      whitePercent = mateIn > 0 ? 100 : 0;
    } else {
      // Centipawn score — convert to visual percentage
      // Use sigmoid-like mapping: ±500cp ≈ ±90%, ±200cp ≈ ±70%
      const cp = bestPV.score;
      displayText = (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1);
      // Sigmoid: 50 + 50 * tanh(cp / 400)
      // This gives smooth visual transitions and caps at ~97% for extreme evals
      whitePercent = 50 + 50 * Math.tanh(cp / 400);
    }

    // Determine whose perspective we're viewing from
    const flipped = BoardDetector.isFlipped();

    // When flipped (playing as black), invert the bar
    const fillPercent = flipped ? (100 - whitePercent) : whitePercent;

    fillEl.style.height = `${fillPercent}%`;
    labelEl.textContent = displayText;

    // Position label near the advantaged side
    if (whitePercent > 50) {
      // White advantage — label at bottom (white side)
      labelEl.style.bottom = '4px';
      labelEl.style.top = 'auto';
      labelEl.style.color = '#1a1a1a';
    } else if (whitePercent < 50) {
      // Black advantage — label at top (black side)
      labelEl.style.top = '4px';
      labelEl.style.bottom = 'auto';
      labelEl.style.color = '#f0f0f0';
    } else {
      labelEl.style.bottom = '4px';
      labelEl.style.top = 'auto';
      labelEl.style.color = '#1a1a1a';
    }
  }

  // ── Start ──────────────────────────────────────────────────
  init();
})();

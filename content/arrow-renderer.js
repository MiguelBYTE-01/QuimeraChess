// ============================================================
// Chess Stockfish Analyzer — Arrow Renderer (arrow-renderer.js)
// Draws SVG arrows on the chess board to visualize best moves
// Shows ONLY the immediate best move per PV line (1 arrow each)
// ============================================================

const ArrowRenderer = (() => {
  // ── Very distinct colors per rank ──────────────────────────
  const ARROW_COLORS = [
    { color: '#00C853', width: 16 }, // 1st — green
    { color: '#2979FF', width: 13 }, // 2nd — blue
    { color: '#FFD600', width: 11 }, // 3rd — yellow
    { color: '#FF6D00', width: 9  }, // 4th — orange
    { color: '#D50000', width: 7  }, // 5th — red
  ];

  // Full opacity — solid, easy to see
  const ARROW_OPACITY = 0.88;

  let svgOverlay = null;
  let overlayContainer = null;

  // ── Create SVG Overlay aligned to the board ────────────────
  function createOverlay() {
    removeOverlay();
    const board = BoardDetector.findBoard();
    if (!board) return null;

    const rect = BoardDetector.getBoardRect();
    if (!rect) return null;

    overlayContainer = document.createElement('div');
    overlayContainer.id = 'csa-arrow-overlay-container';
    overlayContainer.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      'pointer-events:none',
      'z-index:9999',
      'overflow:hidden'
    ].join(';');

    svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgOverlay.id = 'csa-arrow-svg';
    svgOverlay.setAttribute('width', '100%');
    svgOverlay.setAttribute('height', '100%');
    svgOverlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    svgOverlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svgOverlay.appendChild(defs);
    overlayContainer.appendChild(svgOverlay);

    // Attach directly to the board element for correct alignment
    const boardStyle = window.getComputedStyle(board);
    if (boardStyle.position === 'static') {
      board.style.position = 'relative';
    }
    board.appendChild(overlayContainer);

    return svgOverlay;
  }

  function removeOverlay() {
    if (overlayContainer) {
      overlayContainer.remove();
      overlayContainer = null;
      svgOverlay = null;
    }
    document.querySelectorAll('#csa-arrow-overlay-container').forEach(el => el.remove());
  }

  function clearArrows() {
    if (!svgOverlay) return;
    const children = Array.from(svgOverlay.children);
    for (const child of children) {
      if (child.tagName.toLowerCase() !== 'defs') {
        svgOverlay.removeChild(child);
      }
    }
    const defs = svgOverlay.querySelector('defs');
    if (defs) defs.innerHTML = '';
  }

  // ── Arrowhead marker ───────────────────────────────────────
  function ensureMarker(color, id, strokeWidth, targetSize) {
    const defs = svgOverlay.querySelector('defs');
    if (!defs) return;
    
    // Always recreate to ensure it scales correctly if board resized
    let marker = defs.querySelector(`#${id}`);
    if (marker) marker.remove();

    marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('viewBox', '0 0 10 10');
    // Using refX=2 ensures the line penetrates the arrowhead slightly to prevent gaps,
    // but leaves most of the line exposed so the body is visible on short moves.
    marker.setAttribute('refX', '2');
    marker.setAttribute('refY', '5');
    
    // Scale marker inversely to stroke width so all arrows have the same head size
    const scale = targetSize / strokeWidth;
    marker.setAttribute('markerWidth', String(scale));
    marker.setAttribute('markerHeight', String(scale));
    marker.setAttribute('orient', 'auto-start-reverse');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    path.setAttribute('fill', color);
    path.setAttribute('fill-opacity', String(ARROW_OPACITY));

    marker.appendChild(path);
    defs.appendChild(marker);
  }

  // ── Draw a single solid arrow ──────────────────────────────
  function drawSolidArrow(fromSq, toSq, colorConfig, rankIndex, animate) {
    if (!svgOverlay) return;

    const from = BoardDetector.squareToPixel(fromSq);
    const to = BoardDetector.squareToPixel(toSq);
    if (!from || !to) return;

    const strokeWidth = colorConfig.width;
    const color = colorConfig.color;

    const rect = BoardDetector.getBoardRect();
    const squareSize = rect ? rect.width / 8 : 80;
    
    // Increased standard arrowhead size by 15%
    const targetSize = squareSize * 0.69;

    const markerId = `csa-m-${color.replace('#', '')}`;
    ensureMarker(color, markerId, strokeWidth, targetSize);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    // Small gaps from center (5% of square) to allow space for the arrow body
    const tipDistance = squareSize * 0.05;
    // headShorten = tipDistance + (distance from refX to tip = 80% of targetSize)
    const headShorten = tipDistance + (targetSize * 0.8);
    const tailShorten = squareSize * 0.05;

    const endX = to.x - (dx / len) * headShorten;
    const endY = to.y - (dy / len) * headShorten;
    const startX = from.x + (dx / len) * tailShorten;
    const startY = from.y + (dy / len) * tailShorten;

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('csa-arrow');

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', startX);
    line.setAttribute('y1', startY);
    line.setAttribute('x2', endX);
    line.setAttribute('y2', endY);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', strokeWidth);
    line.setAttribute('stroke-opacity', ARROW_OPACITY);
    line.setAttribute('marker-end', `url(#${markerId})`);

    group.appendChild(line);

    if (animate) {
      group.style.opacity = '0';
      group.style.transition = 'opacity 0.35s ease-out';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { group.style.opacity = '1'; });
      });
    }

    svgOverlay.appendChild(group);
  }

  // ── Draw analysis arrows — ONLY 1st move per PV line ───────
  function drawAnalysisArrows(results, config) {
    // If overlay doesn't exist OR was detached during a SPA navigation, recreate it
    if (!svgOverlay || !document.body.contains(svgOverlay)) {
      createOverlay();
    }
    if (!svgOverlay) return;

    clearArrows();

    // Update SVG to match board size
    const rect = BoardDetector.getBoardRect();
    if (rect) {
      overlayContainer.style.width = `${rect.width}px`;
      overlayContainer.style.height = `${rect.height}px`;
      svgOverlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    }

    const showLines = Math.min(config.multiPV || 3, 5);
    const animate = config.animations !== false;

    // Sort: draw worst first so best appears on top
    const pvKeys = Object.keys(results)
      .map(Number)
      .filter(k => k >= 1 && k <= showLines)
      .sort((a, b) => b - a);

    for (const pvNum of pvKeys) {
      const pvData = results[pvNum];
      if (!pvData || !pvData.pv || pvData.pv.length === 0) continue;

      const colorConfig = ARROW_COLORS[pvNum - 1] || ARROW_COLORS[4];

      // ONLY draw the FIRST move (the immediate best move for this PV)
      const firstMove = BoardDetector.uciMoveToSquares(pvData.pv[0]);
      if (!firstMove) continue;

      drawSolidArrow(firstMove.from, firstMove.to, colorConfig, pvNum - 1, animate);
    }
  }

  function updatePosition() {
    if (!overlayContainer || !svgOverlay) return;
    const rect = BoardDetector.getBoardRect();
    if (!rect) return;
    overlayContainer.style.width = `${rect.width}px`;
    overlayContainer.style.height = `${rect.height}px`;
    svgOverlay.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  }

  return {
    createOverlay,
    removeOverlay,
    clearArrows,
    drawSolidArrow,
    drawAnalysisArrows,
    updatePosition,
    ARROW_COLORS
  };
})();

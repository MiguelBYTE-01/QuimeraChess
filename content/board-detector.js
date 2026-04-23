// ============================================================
// Chess Stockfish Analyzer — Board Detector (board-detector.js)
// Extracts FEN from Chess.com and Lichess.org boards
// ============================================================

const BoardDetector = (() => {
  // ── Piece Mapping ──────────────────────────────────────────
  const CHESSCOM_PIECE_MAP = {
    'wp': 'P', 'wn': 'N', 'wb': 'B', 'wr': 'R', 'wq': 'Q', 'wk': 'K',
    'bp': 'p', 'bn': 'n', 'bb': 'b', 'br': 'r', 'bq': 'q', 'bk': 'k'
  };

  const LICHESS_PIECE_MAP = {
    'white+pawn': 'P', 'white+knight': 'N', 'white+bishop': 'B',
    'white+rook': 'R', 'white+queen': 'Q', 'white+king': 'K',
    'black+pawn': 'p', 'black+knight': 'n', 'black+bishop': 'b',
    'black+rook': 'r', 'black+queen': 'q', 'black+king': 'k'
  };

  // ── Site Detection ─────────────────────────────────────────
  function detectSite() {
    const host = window.location.hostname;
    if (host.includes('chess.com')) return 'chesscom';
    if (host.includes('lichess.org')) return 'lichess';
    return null;
  }

  // ── Board Element Detection ────────────────────────────────
  function findBoard() {
    const site = detectSite();
    if (site === 'chesscom') {
      return document.querySelector('wc-chess-board') ||
             document.querySelector('chess-board') ||
             document.querySelector('.board');
    }
    if (site === 'lichess') {
      return document.querySelector('cg-board') ||
             document.querySelector('.cg-board-wrap cg-board') ||
             document.querySelector('.main-board cg-board');
    }
    return null;
  }

  // ── Board Orientation ──────────────────────────────────────
  function isFlipped() {
    const site = detectSite();
    if (site === 'chesscom') {
      const board = document.querySelector('wc-chess-board') || document.querySelector('chess-board');
      if (board) {
        // Modern Chess.com uses orientation attribute
        if (board.getAttribute('orientation') === 'black') return true;
        return board.classList.contains('flipped') ||
               board.getAttribute('data-flipped') === 'true';
      }
    }
    if (site === 'lichess') {
      const boardWrap = document.querySelector('.cg-wrap');
      if (boardWrap) {
        return boardWrap.classList.contains('orientation-black');
      }
    }
    return false;
  }

  // ── Chess.com FEN Extraction ───────────────────────────────
  function extractFENChessCom() {
    const board = new Array(8).fill(null).map(() => new Array(8).fill(''));
    const pieces = document.querySelectorAll('.piece');

    for (const piece of pieces) {
      let pieceType = null;
      let squareFile = -1;
      let squareRank = -1;

      for (const cls of piece.classList) {
        if (CHESSCOM_PIECE_MAP[cls]) {
          pieceType = CHESSCOM_PIECE_MAP[cls];
        }
        const squareMatch = cls.match(/^square-(\d)(\d)$/);
        if (squareMatch) {
          squareFile = parseInt(squareMatch[1]) - 1;
          squareRank = parseInt(squareMatch[2]) - 1;
        }
      }

      if (pieceType && squareFile >= 0 && squareRank >= 0) {
        const fenRow = 7 - squareRank;
        const fenCol = squareFile;
        board[fenRow][fenCol] = pieceType;
      }
    }

    return boardToFEN(board);
  }

  // ── Lichess FEN Extraction ─────────────────────────────────
  function extractFENLichess() {
    const board = new Array(8).fill(null).map(() => new Array(8).fill(''));
    const boardEl = document.querySelector('cg-board');
    if (!boardEl) return null;

    const boardRect = boardEl.getBoundingClientRect();
    const squareSize = boardRect.width / 8;

    const pieces = boardEl.querySelectorAll('piece');
    const flipped = isFlipped();

    for (const piece of pieces) {
      let pieceType = null;
      let color = null;
      let type = null;

      for (const cls of piece.classList) {
        if (cls === 'white') color = 'white';
        else if (cls === 'black') color = 'black';
        else if (['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'].includes(cls)) type = cls;
      }

      if (color && type) {
        pieceType = LICHESS_PIECE_MAP[`${color}+${type}`];
      }
      if (!pieceType) continue;

      let file = -1;
      let rank = -1;

      const transform = piece.style.transform || piece.getAttribute('style') || '';
      const translateMatch = transform.match(/translate\((\d+(?:\.\d+)?)px\s*,\s*(\d+(?:\.\d+)?)px\)/);

      if (translateMatch) {
        const px = parseFloat(translateMatch[1]);
        const py = parseFloat(translateMatch[2]);
        file = Math.round(px / squareSize);
        rank = Math.round(py / squareSize);
        if (flipped) {
          file = 7 - file;
          rank = 7 - rank;
        }
      } else {
        const cgKey = piece.getAttribute('cgKey') || piece.dataset.key;
        if (cgKey && cgKey.length === 2) {
          file = cgKey.charCodeAt(0) - 97;
          rank = 7 - (parseInt(cgKey[1]) - 1);
        }
      }

      if (pieceType && file >= 0 && file < 8 && rank >= 0 && rank < 8) {
        board[rank][file] = pieceType;
      }
    }

    return boardToFEN(board);
  }

  // ── Board Array to FEN String ──────────────────────────────
  function boardToFEN(board) {
    let fen = '';

    for (let rank = 0; rank < 8; rank++) {
      let emptyCount = 0;

      for (let file = 0; file < 8; file++) {
        if (board[rank][file] === '') {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            fen += emptyCount;
            emptyCount = 0;
          }
          fen += board[rank][file];
        }
      }

      if (emptyCount > 0) {
        fen += emptyCount;
      }

      if (rank < 7) fen += '/';
    }

    const turn = detectTurn();
    
    // Calculate valid castling rights to prevent Stockfish from rejecting the FEN
    // Stockfish WILL silently freeze if a FEN claims castling rights but the pieces aren't on their home squares!
    let castling = '';
    if (board[7][4] === 'K') {
      if (board[7][7] === 'R') castling += 'K';
      if (board[7][0] === 'R') castling += 'Q';
    }
    if (board[0][4] === 'k') {
      if (board[0][7] === 'r') castling += 'k';
      if (board[0][0] === 'r') castling += 'q';
    }
    if (castling === '') castling = '-';

    fen += ` ${turn} ${castling} - 0 1`;
    return fen;
  }

  // ═══════════════════════════════════════════════════════════
  // ── ROBUST Turn Detection ─────────────────────────────────
  // Uses multiple strategies in priority order
  // ═══════════════════════════════════════════════════════════
  function detectTurn() {
    const site = detectSite();

    if (site === 'chesscom') return detectTurnChessCom();
    if (site === 'lichess') return detectTurnLichess();

    return 'w';
  }

  function detectTurnChessCom() {
    // ── Strategy 1: Highlighted squares (most reliable) ─────
    // Chess.com highlights the last move with .highlight class
    // The piece on the "to" square tells us who just moved
    const turn1 = detectTurnFromHighlights();
    if (turn1) return turn1;

    // ── Strategy 2: Running clock (live games) ──────────────
    const turn2 = detectTurnFromClocks();
    if (turn2) return turn2;

    // ── Strategy 3: Move list / notation panel ──────────────
    const turn3 = detectTurnFromMoveList();
    if (turn3) return turn3;

    // ── Strategy 4: Selected/active move node ───────────────
    const turn4 = detectTurnFromActiveNode();
    if (turn4) return turn4;

    return 'w'; // Starting position default
  }

  // Strategy 1: Check highlighted squares on the board
  function detectTurnFromHighlights() {
    const highlights = document.querySelectorAll('.highlight');
    if (highlights.length < 2) return null; // No last move = starting pos

    // Find the destination square of the last move
    // Highlights come in pairs (from + to), find which has a piece on it
    for (const hl of highlights) {
      // Get square coordinates from highlight class (e.g., "highlight square-45")
      let sqFile = -1, sqRank = -1;
      for (const cls of hl.classList) {
        const m = cls.match(/^square-(\d)(\d)$/);
        if (m) {
          sqFile = parseInt(m[1]);
          sqRank = parseInt(m[2]);
        }
      }
      if (sqFile < 0) continue;

      // Check if a piece is on this square
      const pieceOnSquare = document.querySelector(`.piece.square-${sqFile}${sqRank}`);
      if (pieceOnSquare) {
        // Determine the piece color
        for (const cls of pieceOnSquare.classList) {
          if (cls.startsWith('w') && CHESSCOM_PIECE_MAP[cls]) {
            return 'b'; // White just moved → Black's turn
          }
          if (cls.startsWith('b') && CHESSCOM_PIECE_MAP[cls]) {
            return 'w'; // Black just moved → White's turn
          }
        }
      }
    }
    return null;
  }

  // Strategy 2: Running clock detection
  function detectTurnFromClocks() {
    // Try multiple Chess.com clock selectors
    const selectors = [
      '.clock-component.clock-running',
      '.clock-running',
      '[class*="clock"][class*="running"]'
    ];

    for (const sel of selectors) {
      const runningClock = document.querySelector(sel);
      if (!runningClock) continue;

      // Determine if it's the bottom or top clock
      const clockRect = runningClock.getBoundingClientRect();
      const boardEl = findBoard();
      if (!boardEl) continue;
      const boardRect = boardEl.getBoundingClientRect();
      const boardMiddleY = boardRect.top + boardRect.height / 2;

      // Clock below board middle = bottom player's clock running
      const isBottom = clockRect.top > boardMiddleY;
      const flipped = isFlipped();

      // Bottom player is White (not flipped) or Black (flipped)
      if (isBottom) {
        return flipped ? 'b' : 'w';
      } else {
        return flipped ? 'w' : 'b';
      }
    }
    return null;
  }

  // Strategy 3: Count moves in the notation panel
  function detectTurnFromMoveList() {
    // Chess.com uses .node elements inside .move containers
    // Each .move has up to 2 nodes (white move + black move)
    const moveNodes = document.querySelectorAll('.move .node, .main-line-ply');

    if (moveNodes.length === 0) return null; // No moves played

    // Count total half-moves
    // Filter out empty/placeholder nodes
    let halfMoves = 0;
    for (const node of moveNodes) {
      const text = node.textContent.trim();
      // Skip empty nodes and non-move text (like "...")
      if (text && text !== '...' && /[a-hRNBQKO]/.test(text)) {
        halfMoves++;
      }
    }

    if (halfMoves === 0) return null;

    // But we need to know which node is currently SELECTED (in analysis/review)
    // because the user might be looking at a historical position
    const selectedNode = document.querySelector('.move .node.selected, .move .node.active, .node.selected, .node.active');
    if (selectedNode) {
      // Check if the selected node is a white or black move
      // In Chess.com, within each .move container:
      // - First .node = white's move
      // - Second .node = black's move
      const parentMove = selectedNode.closest('.move');
      if (parentMove) {
        const nodes = parentMove.querySelectorAll('.node');
        const nodeArray = Array.from(nodes);
        const selectedIndex = nodeArray.indexOf(selectedNode);

        if (selectedIndex === 0) {
          // White's move is selected → we're viewing position after white moved → black's turn
          return 'b';
        } else if (selectedIndex >= 1) {
          // Black's move is selected → we're viewing position after black moved → white's turn
          return 'w';
        }
      }

      // Fallback: check data-color attribute
      const dataColor = selectedNode.getAttribute('data-color');
      if (dataColor === 'white') return 'b'; // After white's move → black's turn
      if (dataColor === 'black') return 'w';
    }

    // Fallback: odd total half-moves = black's turn, even = white's turn
    return (halfMoves % 2 === 0) ? 'w' : 'b';
  }

  // Strategy 4: Active node with data-ply attribute
  function detectTurnFromActiveNode() {
    const activeNode = document.querySelector('[data-ply].selected, [data-ply].active, [data-ply]:focus');
    if (activeNode) {
      const ply = parseInt(activeNode.getAttribute('data-ply'));
      if (!isNaN(ply)) {
        // ply 1 = after white's 1st move → black's turn
        // ply 2 = after black's 1st move → white's turn
        return (ply % 2 === 0) ? 'w' : 'b';
      }
    }
    return null;
  }

  // ── Lichess Turn Detection ─────────────────────────────────
  function detectTurnLichess() {
    // Strategy 1: Turn indicator element
    const turnIndicator = document.querySelector('.rclock-turn');
    if (turnIndicator) {
      return turnIndicator.classList.contains('white') ? 'w' : 'b';
    }

    // Strategy 2: Running clock
    const runningClock = document.querySelector('.rclock.rclock-running, .rclock-running');
    if (runningClock) {
      const isBottom = runningClock.closest('.rclock-bottom') !== null;
      return (isBottom !== isFlipped()) ? 'w' : 'b';
    }

    // Strategy 3: Move list (Lichess uses l-moves or move-list)
    const moves = document.querySelectorAll('l4x kwdb, move, .move');
    if (moves.length > 0) {
      return (moves.length % 2 === 0) ? 'w' : 'b';
    }

    // Strategy 4: Active move in analysis
    const activePly = document.querySelector('.active[data-ply]');
    if (activePly) {
      const ply = parseInt(activePly.getAttribute('data-ply'));
      if (!isNaN(ply)) {
        return (ply % 2 === 0) ? 'w' : 'b';
      }
    }

    return 'w';
  }

  // ── Get Board Dimensions ───────────────────────────────────
  function getBoardRect() {
    const board = findBoard();
    if (!board) return null;
    const r = board.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  function getSquareSize() {
    const rect = getBoardRect();
    if (!rect) return 0;
    return rect.width / 8;
  }

  // ── Algebraic to Pixel Coordinates ─────────────────────────
  function squareToPixel(squareStr) {
    const file = squareStr.charCodeAt(0) - 97;
    const rank = parseInt(squareStr[1]) - 1;

    const rect = getBoardRect();
    if (!rect) return null;

    const sqSize = rect.width / 8;
    const flipped = isFlipped();

    let x, y;
    if (flipped) {
      x = (7 - file) * sqSize + sqSize / 2;
      y = rank * sqSize + sqSize / 2;
    } else {
      x = file * sqSize + sqSize / 2;
      y = (7 - rank) * sqSize + sqSize / 2;
    }

    return { x, y };
  }

  // ── UCI Move to Square Pair ────────────────────────────────
  function uciMoveToSquares(uciMove) {
    if (!uciMove || uciMove.length < 4) return null;
    return {
      from: uciMove.substring(0, 2),
      to: uciMove.substring(2, 4),
      promotion: uciMove.length > 4 ? uciMove[4] : null
    };
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    detectSite,
    findBoard,
    isFlipped,
    getBoardRect,
    getSquareSize,
    squareToPixel,
    uciMoveToSquares,

    extractFEN() {
      const site = detectSite();
      if (site === 'chesscom') return extractFENChessCom();
      if (site === 'lichess') return extractFENLichess();
      return null;
    }
  };
})();

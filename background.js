// ============================================================
// Quimera Chess — Service Worker (background.js)
// Manages offscreen document, routes messages, handles commands
// v1.18.3
// ============================================================

const DEFAULT_CONFIG = {
  engineId: 'sf16',        // 'sf16' | 'sf18lite' — active engine
  hashMB: 4,               // WebAssembly hash table size in MB (2-32)
  elo: 2300,
  limitStrength: false,     // Off by default — full strength
  searchMode: 'depth',      // 'depth' | 'movetime' | 'nodes'
  searchValue: 20,
  multiPV: 3,
  analyzeFor: 'both',       // 'auto' | 'white' | 'black' | 'both'
  animations: true,
  showEvalBar: true,        // Show/hide evaluation bar on board
  analysisActive: false
};

// ── Offscreen Document Management ──────────────────────────────
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length > 0) return;
  } catch (e) {
    // getContexts not available in older Chrome — proceed to create
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  try {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Running Stockfish WASM chess engine in a Web Worker'
    });
    await creatingOffscreen;
  } catch (e) {
    // Document might already exist (race condition on rapid toggling)
    console.warn('[Background] Offscreen creation error (may already exist):', e.message);
  }
  creatingOffscreen = null;
}

async function closeOffscreenDocument() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {
    // Already closed — fine
  }
}

// ── Configuration ──────────────────────────────────────────────
async function getConfig() {
  const result = await chrome.storage.local.get('config');
  const stored = result.config || {};
  // Merge defaults — ensures new fields added in updates are present
  return { ...DEFAULT_CONFIG, ...stored };
}

async function setConfig(updates) {
  const config = await getConfig();
  const newConfig = { ...config, ...updates };
  await chrome.storage.local.set({ config: newConfig });
  return newConfig;
}

// ── Message Routing ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'background') {
    handleBackgroundMessage(message, sender, sendResponse);
    return true; // signals async response
  }

  // Forward messages from offscreen → content script tab
  if (message.target === 'content' && message.tabId) {
    chrome.tabs.sendMessage(message.tabId, message).catch(() => {});
  }
});

async function handleBackgroundMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'get-config':
        sendResponse({ config: await getConfig() });
        break;

      case 'set-config': {
        const newConfig = await setConfig(message.updates);
        sendResponse({ config: newConfig });
        // Notify all open chess tabs of config change
        broadcastToContentScripts({
          target: 'content',
          type: 'config-updated',
          config: newConfig
        });
        break;
      }


      case 'analyze':
        await handleAnalyze(message, sender);
        sendResponse({ status: 'analysis-started' });
        break;

      case 'stop-analysis':
        await handleStop();
        sendResponse({ status: 'stopped' });
        break;

      case 'reset-engine':
        // Nuclear option: close AND immediately recreate the offscreen document
        await closeOffscreenDocument();
        await ensureOffscreenDocument();
        sendResponse({ status: 'reset' });
        break;

      case 'toggle-analysis':
        await handleToggle(sender);
        sendResponse({ status: 'toggled' });
        break;

      default:
        sendResponse({ error: `Unknown message type: ${message.type}` });
    }
  } catch (error) {
    console.error('[Background] Error handling message:', message.type, error);
    sendResponse({ error: error.message });
  }
}

async function handleAnalyze(message, sender) {
  await ensureOffscreenDocument();
  const config = await getConfig();
  const tabId = sender.tab ? sender.tab.id : message.tabId;

  const payload = {
    target: 'offscreen',
    type: 'analyze',
    fen: message.fen,
    config: config,
    tabId: tabId
  };

  try {
    chrome.runtime.sendMessage(payload);
  } catch (e) {
    console.error('[Background] Failed to send analyze to offscreen:', e);
    // Recreate offscreen and retry once
    await closeOffscreenDocument();
    await ensureOffscreenDocument();
    try {
      chrome.runtime.sendMessage(payload);
    } catch (e2) {
      console.error('[Background] Retry also failed:', e2);
    }
  }
}

async function handleStop() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length > 0) {
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
    }
  } catch (e) {
    // Offscreen not available — nothing to stop
  }
}

async function handleToggle(sender) {
  const config = await getConfig();
  const newActive = !config.analysisActive;
  await setConfig({ analysisActive: newActive });

  const tabId = sender.tab ? sender.tab.id : null;
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      target: 'content',
      type: 'toggle-analysis',
      active: newActive
    }).catch(() => {});
  }

  if (!newActive) {
    await handleStop();
  }
}

function broadcastToContentScripts(message) {
  chrome.tabs.query(
    { url: ['*://*.chess.com/*', '*://*.lichess.org/*'] },
    (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
  );
}

// ── Keyboard Shortcut ──────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-analysis') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && (tab.url.includes('chess.com') || tab.url.includes('lichess.org'))) {
      const config = await getConfig();
      const newActive = !config.analysisActive;
      await setConfig({ analysisActive: newActive });

      chrome.tabs.sendMessage(tab.id, {
        target: 'content',
        type: 'toggle-analysis',
        active: newActive
      }).catch(() => {});

      if (!newActive) await handleStop();
    }
  }
});

// ── Installation / Update ──────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
    console.log('[Quimera Chess] Extension installed with default config');
  } else if (details.reason === 'update') {
    // Merge new defaults into existing config (non-destructive)
    const existing = await chrome.storage.local.get('config');
    const merged = { ...DEFAULT_CONFIG, ...(existing.config || {}) };
    await chrome.storage.local.set({ config: merged });
    console.log('[Quimera Chess] Extension updated, config migrated');
  }
});

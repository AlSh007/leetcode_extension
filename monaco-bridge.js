// MAIN-world bridge: hands the full Monaco editor buffer to the isolated-world
// content script.
//
// Why this file exists: Monaco virtualizes rendering, so `.view-line` nodes only
// exist for the lines currently scrolled into view. Scraping the DOM therefore
// captures whatever is on screen and silently drops the rest. The complete
// buffer lives on the text model, but `monaco` is a page global and content
// scripts run in an isolated world where page globals (and DOM expandos set by
// page scripts) are invisible.
//
// Protocol: content.js dispatches '__lc2gh_request_code' on `document`. DOM event
// dispatch is synchronous and crosses the isolated/MAIN world boundary, so by the
// time dispatchEvent() returns, the mirror node below holds a fresh JSON
// snapshot that the isolated world can read straight off the shared DOM.

(function () {
  const REQUEST_EVENT = '__lc2gh_request_code';
  const MIRROR_ID = '__lc2gh_code_mirror';

  if (window.__lc2ghBridgeInstalled) return;
  window.__lc2ghBridgeInstalled = true;

  function mirrorNode() {
    let node = document.getElementById(MIRROR_ID);
    if (!node || !node.isConnected) {
      // <script type="application/json"> is inert: never executed, never rendered.
      node = document.createElement('script');
      node.type = 'application/json';
      node.id = MIRROR_ID;
      (document.head || document.documentElement).appendChild(node);
    }
    return node;
  }

  function sizeOf(model) {
    try { return model.getLineCount(); } catch (e) { return 0; }
  }

  // LeetCode mounts several Monaco instances (solution editor, diff views, the
  // playground), so the first model is not reliably the one being submitted.
  // Prefer a model attached to a visible editor, then the largest.
  function pickModel(monaco) {
    const candidates = [];

    if (typeof monaco.editor.getEditors === 'function') {
      for (const editor of monaco.editor.getEditors()) {
        let model = null;
        let node = null;
        try { model = editor.getModel(); } catch (e) { /* detached editor */ }
        try { node = editor.getDomNode(); } catch (e) { /* not yet mounted */ }
        if (!model) continue;
        const visible = !!(node && node.isConnected && node.getClientRects().length > 0);
        candidates.push({ model, score: (visible ? 1e9 : 0) + sizeOf(model) });
      }
    }

    if (candidates.length === 0 && typeof monaco.editor.getModels === 'function') {
      for (const model of monaco.editor.getModels()) {
        candidates.push({ model, score: sizeOf(model) });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.length > 0 ? candidates[0].model : null;
  }

  function snapshot() {
    const monaco = window.monaco;
    if (!monaco || !monaco.editor) return { ok: false, reason: 'monaco-not-loaded' };

    let model;
    try { model = pickModel(monaco); } catch (e) { return { ok: false, reason: 'pick-model-failed: ' + e.message }; }
    if (!model) return { ok: false, reason: 'no-model' };

    let code;
    try { code = model.getValue(); } catch (e) { return { ok: false, reason: 'get-value-failed: ' + e.message }; }
    if (typeof code !== 'string' || code.trim().length === 0) return { ok: false, reason: 'empty-model' };

    let languageId = '';
    try {
      if (typeof model.getLanguageId === 'function') languageId = model.getLanguageId();
      else if (typeof model.getModeId === 'function') languageId = model.getModeId();
    } catch (e) { /* older/newer Monaco, not fatal */ }

    return { ok: true, code, languageId, lineCount: sizeOf(model), ts: Date.now() };
  }

  document.addEventListener(REQUEST_EVENT, function () {
    let payload;
    try { payload = snapshot(); } catch (e) { payload = { ok: false, reason: 'snapshot-threw: ' + e.message }; }
    try { mirrorNode().textContent = JSON.stringify(payload); } catch (e) { /* nothing we can do */ }
  });
})();

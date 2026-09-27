// Content script: detect LeetCode Submit -> Accepted and push solution to GitHub
// - Reads the complete Monaco buffer via monaco-bridge.js (MAIN world), because
//   `.view-line` nodes only exist for the lines currently scrolled into view
// - Captures metadata at Submit click time to avoid losing it after DOM changes
// - Uses an immediate-ack pattern: background sends an immediate response and does work asynchronously

(function () {
  // single global state object
  window.__leetcodePush = window.__leetcodePush || { pending: new Set(), pushed: new Set(), metadata: {}, initialized: false };
  if (window.__leetcodePush.initialized) return;
  window.__leetcodePush.initialized = true;

  function isChromeAvailable() {
    try { 
      // Check if chrome and required APIs are available
      if (typeof chrome === 'undefined') {
        console.error('[LeetCode Extension] chrome is undefined');
        return false;
      }
      if (!chrome.storage) {
        console.error('[LeetCode Extension] chrome.storage is unavailable');
        return false;
      }
      if (!chrome.runtime) {
        console.error('[LeetCode Extension] chrome.runtime is unavailable');
        return false;
      }
      if (!chrome.runtime.sendMessage) {
        console.error('[LeetCode Extension] chrome.runtime.sendMessage is unavailable');
        return false;
      }
      return true;
    } catch (e) { 
      console.error('[LeetCode Extension] Chrome API check threw error:', e);
      return false; 
    }
  }

  const LANGUAGE_EXTENSIONS = {
    python: 'py', python3: 'py',
    java: 'java',
    'c++': 'cpp', cpp: 'cpp',
    c: 'c',
    'c#': 'cs', csharp: 'cs',
    javascript: 'js',
    typescript: 'ts',
    ruby: 'rb',
    swift: 'swift',
    go: 'go', golang: 'go',
    scala: 'scala',
    kotlin: 'kt',
    rust: 'rs',
    php: 'php',
    mysql: 'sql', mssql: 'sql', oracle: 'sql', sql: 'sql', postgresql: 'sql',
    bash: 'sh', shell: 'sh',
    dart: 'dart',
    racket: 'rkt',
    erlang: 'erl',
    elixir: 'ex'
  };

  function getFileExtension(lang) {
    return LANGUAGE_EXTENSIONS[(lang || '').toLowerCase()] || lang || 'txt';
  }

  function getLanguage() {
    // List of known programming languages to validate against
    const knownLanguages = ['python', 'python3', 'java', 'c++', 'c', 'c#', 'csharp', 'javascript', 'typescript', 
                           'ruby', 'swift', 'go', 'golang', 'scala', 'kotlin', 'rust', 'php', 'mysql', 'mssql',
                           'oracle', 'bash', 'shell', 'dart', 'racket', 'erlang', 'elixir', 'sql', 'postgresql'];
    
    // Try multiple selectors for language detection (ordered by specificity)
    const selectors = [
      "button[id*='headlessui-listbox-button'][id*='lang']", // Modern LeetCode language dropdown with 'lang' in ID
      "button[id*='headlessui-listbox-button']", // Modern LeetCode language dropdown
      ".ant-select-selection-item",
      "select[data-cy='lang-select']",
      "[class*='lang'] button",
      "div[class*='lang'] button",
      "button[aria-haspopup='dialog']", // Current (Radix UI) LeetCode language dropdown
      "button" // Last-resort catch-all; the known-language whitelist below keeps this safe
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = (el.innerText || el.textContent || el.value || '').trim();
        if (text && text.length > 0 && text.length < 30) {
          const normalized = text.replace(/\s+/g, '').toLowerCase();
          // Only accept if it's a known programming language (not UI text like "Comment", "Solutions", etc.)
          const isKnownLanguage = knownLanguages.some(lang => {
            const langNormalized = lang.replace(/\+/g, 'plus').replace(/#/g, 'sharp');
            const textNormalized = normalized.replace(/\+/g, 'plus').replace(/#/g, 'sharp');
            return textNormalized === langNormalized || textNormalized.startsWith(langNormalized) || langNormalized.startsWith(textNormalized);
          });
          if (isKnownLanguage) {
            console.log('[LeetCode Extension] ✅ Language detected via', selector, ':', text);
            return text.replace(/\s+/g, '').toLowerCase();
          } else {
            console.log('[LeetCode Extension] Ignoring non-language text:', text, 'from', selector);
          }
        }
      }
    }
    
    console.warn('[LeetCode Extension] ⚠️ Could not detect language, defaulting to py (Python)');
    return 'py';  // Default to Python since that's what user mentioned they mainly use
  }

  // ---------------------------------------------------------------------------
  // Monaco bridge (see monaco-bridge.js)
  //
  // Monaco virtualizes rendering: `.view-line` nodes exist only for the lines
  // currently scrolled into view. Scraping them captures what is on screen and
  // silently truncates the rest -- which is what used to get pushed to GitHub.
  // The complete buffer lives on the text model, but `monaco` is a page global
  // and this script runs in an isolated world, so it cannot reach it directly.
  //
  // monaco-bridge.js runs in the MAIN world and answers the DOM event below by
  // writing a JSON snapshot into a shared mirror node. DOM dispatch is
  // synchronous and crosses the world boundary, so the mirror is already fresh
  // when dispatchEvent() returns and getSolution() stays synchronous.
  // ---------------------------------------------------------------------------
  const BRIDGE_REQUEST_EVENT = '__lc2gh_request_code';
  const BRIDGE_MIRROR_ID = '__lc2gh_code_mirror';

  function readFromBridge() {
    try {
      document.dispatchEvent(new CustomEvent(BRIDGE_REQUEST_EVENT));
    } catch (e) {
      return { ok: false, reason: 'dispatch-failed: ' + e.message };
    }

    const node = document.getElementById(BRIDGE_MIRROR_ID);
    if (!node) return { ok: false, reason: 'bridge-not-installed' };

    try {
      const payload = JSON.parse(node.textContent || '{}');
      if (!payload || typeof payload !== 'object') return { ok: false, reason: 'bad-payload' };
      return payload;
    } catch (e) {
      return { ok: false, reason: 'unparseable-payload: ' + e.message };
    }
  }

  // The CSS-module class names below (e.g. "question-content__JfgR") are
  // generated per LeetCode frontend build and rot whenever they ship a new
  // one - the div-based selectors are a best effort, not a guarantee. The meta
  // description tag is populated for SEO and is far more stable, so it's a
  // fallback of last resort when none of the div selectors matched any text.
  function getProblemDescription() {
    const descEl = document.querySelector('.question-content, .question-content__JfgR, .content, .description, .question__content, [class*="elfjS"]');
    const fromDiv = descEl ? (descEl.innerText || '').trim() : '';
    if (fromDiv) return fromDiv;

    const metaEl = document.querySelector('meta[name="description"], meta[property="og:description"]');
    const fromMeta = metaEl ? (metaEl.getAttribute('content') || '').trim() : '';
    return fromMeta;
  }

  function getSolution() {
    const problemTitle = (document.title || '').replace(/\s*-\s*LeetCode.*$/i, '').trim().replace(/\s+/g, '_');
    const lang = getLanguage();
    const description = getProblemDescription();

    const snapshot = readFromBridge();

    // No buffer means no push. There is deliberately no DOM-scraping fallback:
    // it would commit only the visible lines, which is worse than committing
    // nothing, because a truncated file looks like a successful push.
    if (!snapshot.ok) {
      console.error('[LeetCode Extension] ❌ Could not read the editor buffer:', snapshot.reason);
      console.error('[LeetCode Extension] Not falling back to DOM scraping - it would capture only the lines on screen. Nothing will be pushed.');
      return { code: null, bridgeError: snapshot.reason, problemTitle, lang, description, extractionMethod: 'none', lineCount: 0, charCount: 0 };
    }

    const code = String(snapshot.code || '').replace(/\r\n?/g, '\n');
    const lineCount = code.split('\n').length;
    const charCount = code.length;

    // The model is the source of truth for line order, so the old
    // sort-by-CSS-top and auto-reverse heuristics are gone with the scraping.
    if (snapshot.lineCount && snapshot.lineCount !== lineCount) {
      console.warn('[LeetCode Extension] ⚠️ Line count mismatch - model reports', snapshot.lineCount, 'but snapshot has', lineCount);
    }

    console.log('[LeetCode Extension] Code Extraction Summary:', {
      method: 'monaco-model-bridge',
      lines: lineCount,
      characters: charCount,
      editorReportedLines: snapshot.lineCount,
      monacoLanguageId: snapshot.languageId || '(unknown)',
      firstLine: code.split('\n')[0]?.substring(0, 50) || '',
      lastLine: code.split('\n')[lineCount - 1]?.substring(0, 50) || ''
    });

    return {
      code,
      problemTitle,
      lang,
      description,
      extractionMethod: 'monaco-model-bridge',
      lineCount,
      charCount,
      monacoLanguageId: snapshot.languageId || ''
    };
  }

  // Test seam for test/bridge.test.js, which drives the real extraction path.
  window.__leetcodePush.__getSolution = getSolution;


  function collectMetadata() {
    const url = location.href;
    let difficulty = '';
    const headerCandidates = document.querySelectorAll('h1,h2,h3,div,span');
    for (const el of headerCandidates) {
      const txt = (el.innerText || '').trim();
      if (txt.length > 0 && txt.length < 120) {
        const m = txt.match(/\b(Easy|Medium|Hard)\b/i);
        if (m) { difficulty = m[1]; break; }
      }
    }
    const tagEls = document.querySelectorAll('.topic-tags a, .topic-tags .tag, .tags a, .question-tags a, .question-tags .tag, .tags-item');
    const tags = Array.from(tagEls).map(t => (t.innerText || '').trim()).filter(Boolean);
    let acceptance = '';
    const accMatch = document.body.innerText.match(/Acceptance\s*[:\s]\s*([\d.]+%)/i) || document.body.innerText.match(/([\d.]+)%\s*(acceptance)?/i);
    if (accMatch) acceptance = accMatch[1];
    const canonical = (() => {
      const a = document.querySelector("link[rel='canonical']") || document.querySelector("a[data-cy='question-title-link']");
      return a ? (a.href || a.getAttribute('href')) : url;
    })();
    return { difficulty, tags, acceptance, url: canonical || url };
  }

  // When user clicks Submit, capture metadata and mark pending
  document.addEventListener('click', (e) => {
    try {
      let el = e.target;
      while (el && el !== document) {
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.tagName === 'A') {
          const text = (el.innerText || '').trim();
          const dataE2e = el.getAttribute('data-e2e-locator') || '';
          const dataCy = el.getAttribute('data-cy') || '';
          
          // Check for Submit button via text or data attributes
          if (/submit/i.test(text) || /submit/i.test(dataE2e) || /submit/i.test(dataCy)) {
            console.log('[LeetCode Extension] 🚀 Submit button clicked!');
            const sol = getSolution();
            if (!sol) {
              console.warn('[LeetCode Extension] Failed to extract solution on Submit - will retry on Accepted');
              window.__leetcodePush.pending.add('__unknown__');
              setTimeout(() => { window.__leetcodePush.pending.delete('__unknown__'); }, 30000);
              break;
            }
            const key = `${sol.problemTitle}::${sol.lang}`;
            console.log('[LeetCode Extension] Captured submission:', {
              problem: sol.problemTitle,
              language: sol.lang,
              codeLength: sol.code?.length || 0,
              key: key
            });
            try { window.__leetcodePush.metadata[key] = collectMetadata(); } catch (_) { window.__leetcodePush.metadata[key] = {}; }
            window.__leetcodePush.pushed.delete(key);
            window.__leetcodePush.pending.add(key);
            console.log('[LeetCode Extension] Added to pending:', key);
            setTimeout(() => { 
              if (window.__leetcodePush.pending.has(key)) {
                console.log('[LeetCode Extension] Timeout: removing pending key', key);
                window.__leetcodePush.pending.delete(key); 
                delete window.__leetcodePush.metadata[key]; 
              }
            }, 30000);
            break;
          }
        }
        el = el.parentElement;
      }
    } catch (err) { console.warn('[LeetCode Extension] Submit click handler error:', err); }
  }, true);

  function trySendIfAccepted() {
    try {
      // Check for Accepted in specific result containers first, then fallback to body
      const resultContainers = document.querySelectorAll('[data-e2e-locator*="result"], .result, [class*="ResultCard"], [class*="result"]');
      let hasAccepted = false;
      
      for (const container of resultContainers) {
        if (/Accepted/i.test(container.textContent || '')) {
          hasAccepted = true;
          break;
        }
      }
      
      if (!hasAccepted && !/Accepted/i.test(document.body.innerText)) return;
      
      console.log('[LeetCode Extension] Accepted status detected');
      const solution = getSolution(); 
      if (!solution) {
        console.error('[LeetCode Extension] Could not extract solution code');
        return;
      }
      
      // Validate code is not empty
      if (!solution.code || solution.code.trim().length === 0) {
        console.error('[LeetCode Extension] Code is empty, aborting push');
        return;
      }
      
      // Validate we have a problem title
      if (!solution.problemTitle || solution.problemTitle.length === 0) {
        console.error('[LeetCode Extension] Problem title is empty, aborting push');
        return;
      }
      
      // Enhanced validation for code completeness
      const codeLines = solution.code.split('\n');
      const nonEmptyLines = codeLines.filter(line => line.trim().length > 0).length;
      
      // Check for Python-specific validation
      if (solution.lang && solution.lang.toLowerCase().includes('python')) {
        // Python code should have at least some indentation and structure
        const hasIndentation = solution.code.includes('    ') || solution.code.includes('\t');
        const hasDefOrClass = /\b(def|class)\b/.test(solution.code);
        
        if (nonEmptyLines > 5 && !hasIndentation) {
          console.warn('[LeetCode Extension] ⚠️ Warning: Python code has no indentation - may be incomplete!');
        }
        
        console.log('[LeetCode Extension] Python validation:', {
          hasIndentation,
          hasDefOrClass,
          nonEmptyLines
        });
      }
      
      console.log('[LeetCode Extension] Solution details:', {
        problem: solution.problemTitle,
        language: solution.lang,
        extractionMethod: solution.extractionMethod,
        totalLines: solution.lineCount,
        nonEmptyLines: nonEmptyLines,
        codeLength: solution.code.length,
        descriptionLength: solution.description.length
      });
      
      const key = `${solution.problemTitle}::${solution.lang}`;
      const wasPending = window.__leetcodePush.pending.has(key) || window.__leetcodePush.pending.has('__unknown__');
      
      console.log('[LeetCode Extension] Checking pending status:', {
        lookingFor: key,
        pendingKeys: Array.from(window.__leetcodePush.pending),
        wasPending,
        alreadyPushed: window.__leetcodePush.pushed.has(key)
      });
      
      if (!wasPending) {
        console.log('[LeetCode Extension] ⚠️ No pending submission found for this problem - did you click Submit before getting Accepted?');
        return;
      }
      if (window.__leetcodePush.pushed.has(key)) {
        console.log('[LeetCode Extension] Already pushed this solution');
        return;
      }
      
      console.log('[LeetCode Extension] Attempting to push to GitHub...');
      const metadata = window.__leetcodePush.metadata[key] || {};
      
      if (!isChromeAvailable()) { 
        console.error('[LeetCode Extension] Chrome extension APIs unavailable - aborting push'); 
        window.__leetcodePush.pending.delete(key); 
        delete window.__leetcodePush.metadata[key]; 
        return; 
      }

      chrome.storage.sync.get(['repo','token'], (items) => {
        if (chrome.runtime.lastError) { 
          console.error('[LeetCode Extension] chrome.storage error:', chrome.runtime.lastError); 
          window.__leetcodePush.pending.delete(key); 
          delete window.__leetcodePush.metadata[key]; 
          return; 
        }
        const { repo, token } = items || {}; 
        if (!repo || !token) { 
          console.error('[LeetCode Extension] Repo or token not set in storage. Please configure in extension popup.'); 
          window.__leetcodePush.pending.delete(key); 
          delete window.__leetcodePush.metadata[key]; 
          return; 
        }
        
        console.log('[LeetCode Extension] Sending to GitHub:', repo);
        const dirName = solution.problemTitle;
        try {
          chrome.runtime.sendMessage({
            action: 'pushToGitHub',
            filename: `${solution.problemTitle}.${getFileExtension(solution.lang)}`,
            code: solution.code, 
            language: solution.lang, 
            repo, 
            token, 
            description: solution.description, 
            dirName, 
            metadata,
            extractionMethod: solution.extractionMethod,
            lineCount: solution.lineCount,
            charCount: solution.charCount
          }, (response) => {
            if (chrome.runtime.lastError) { 
              console.error('[LeetCode Extension] sendMessage error:', chrome.runtime.lastError); 
              window.__leetcodePush.pending.delete(key); 
              delete window.__leetcodePush.metadata[key]; 
              return; 
            }
            console.log('[LeetCode Extension] GitHub push response:', response);
            if (response && response.success) { 
              console.log('[LeetCode Extension] ✅ Successfully pushed to GitHub!');
              window.__leetcodePush.pushed.add(key); 
              window.__leetcodePush.pending.delete(key); 
              delete window.__leetcodePush.metadata[key]; 
            }
            else if (response && response.accepted) {
              console.log('[LeetCode Extension] GitHub push accepted, processing in background...');
              window.__leetcodePush.pending.delete(key);
              window.__leetcodePush.pushed.add(key);
            } else {
              console.warn('[LeetCode Extension] GitHub push failed, will retry');
              setTimeout(() => { window.__leetcodePush.pending.delete(key); delete window.__leetcodePush.metadata[key]; }, 10000);
            }
          });
        } catch (sendErr) { 
          console.error('[LeetCode Extension] chrome.runtime.sendMessage threw:', sendErr); 
          window.__leetcodePush.pending.delete(key); 
          delete window.__leetcodePush.metadata[key]; 
        }
      });
    } catch (err) { console.error('[LeetCode Extension] trySendIfAccepted failed:', err); }
  }

  // ---------------------------------------------------------------------------
  // Optional AI features (complexity analysis + progressive hints), via Groq or
  // OpenAI. Entirely additive: if no key is configured for the selected
  // provider, background.js responds with `aiUnavailable: true` and the panel
  // just shows a message instead of a result. Nothing here is on the GitHub
  // push's critical path.
  //
  // Visual language is drawn from the extension's own icon (icons/make_icons.py):
  // the same navy gradient, the same LeetCode-orange accent, and the same
  // "assembled from simple geometric primitives" style, rather than a generic
  // widget look or literal robot imagery.
  // ---------------------------------------------------------------------------
  const AI_PANEL_ID = '__lc2gh_ai_panel';
  const MAX_HINT_LEVEL = 3;

  function nextHintLevel(currentLevel) {
    return Math.min((currentLevel || 0) + 1, MAX_HINT_LEVEL);
  }
  // Test seam for test/bridge.test.js.
  window.__leetcodePush.__nextHintLevel = nextHintLevel;

  function currentProblemKey() {
    try {
      const sol = getSolution();
      return (sol && sol.problemTitle) || '__unknown_problem__';
    } catch (e) {
      return '__unknown_problem__';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Models reliably answer in light markdown (**bold**, `code`, Big-O terms).
  // Rendering it as inline HTML instead of literal asterisks/backticks is what
  // makes results read like a formatted answer rather than raw text. Input is
  // escaped first, so this stays safe to feed into innerHTML even though the
  // text originates from an LLM response - only tags this function adds itself
  // ever reach the output.
  function formatAIText(text) {
    const escaped = escapeHtml(text);
    // Split on backtick-code spans first so bold/Big-O replacements below never
    // reach inside them (e.g. a literal "**" some model puts inside `code`).
    return escaped.split(/(`[^`]+`)/g).map((part) => {
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${part.slice(1, -1)}</code>`;
      }
      return part
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/O\([^)]*\)/g, (m) => `<code>${m}</code>`);
    }).join('');
  }

  // Same four-point construction as a "sparkle" glyph, built as a straight-edge
  // polygon (not a curvy blob) to match the line-and-shape style of the real
  // extension icon. This is the panel's "AI" mark - the toggle button and
  // nothing else, so it doesn't get diluted by reuse elsewhere.
  const SPARK_SVG = '<svg viewBox="0 0 24 24" style="width:100%;height:100%"><polygon points="12,3 14.12,9.88 21,12 14.12,14.12 12,21 9.88,14.12 3,12 9.88,9.88" style="fill:var(--lc2gh-accent)"/></svg>';

  // The "<>" chevrons from the real icon, at panel scale - ties "Complexity"
  // back to "this is about code".
  const CHEVRON_SVG = '<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none;stroke:var(--lc2gh-accent);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round">'
    + '<polyline points="9,6 4,12 9,18"/><polyline points="15,6 20,12 15,18"/></svg>';

  // A minimal lightbulb, built the same way the real icon builds its glyphs -
  // circle + rounded rects, nothing fancier - to mark "Hint" as a distinct idea
  // from "Complexity" while staying in the same visual family.
  const BULB_SVG = '<svg viewBox="0 0 24 24" style="width:100%;height:100%">'
    + '<circle cx="12" cy="10" r="6" style="fill:none;stroke:var(--lc2gh-accent);stroke-width:2"/>'
    + '<rect x="9.5" y="15.5" width="5" height="2.4" rx="1.2" style="fill:var(--lc2gh-accent)"/>'
    + '<rect x="10" y="18.6" width="4" height="1.6" rx="0.8" style="fill:var(--lc2gh-accent)"/></svg>';

  function iconSpan(svgMarkup, sizePx) {
    const span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.style.width = sizePx + 'px';
    span.style.height = sizePx + 'px';
    span.style.flexShrink = '0';
    span.innerHTML = svgMarkup;
    return span;
  }

  function injectAIPanel() {
    try {
      if (document.getElementById(AI_PANEL_ID)) return;

      const style = document.createElement('style');
      style.textContent = `
        #${AI_PANEL_ID} {
          --lc2gh-bg-top: #1E2634; --lc2gh-bg-bottom: #0B0F17;
          --lc2gh-accent: #FFA116; --lc2gh-accent-openai: #58A6FF;
          --lc2gh-text: #E6EDF3; --lc2gh-text-dim: #8A97A8;
          --lc2gh-border: rgba(230,237,243,0.10); --lc2gh-danger: #F85149;
          position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          font-size: 13px; line-height: 1.45;
          display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
        }
        #${AI_PANEL_ID} .__lc2gh_ai_toggle {
          width: 44px; height: 44px; border-radius: 50%; border: none; cursor: pointer; padding: 10px;
          background: linear-gradient(180deg, var(--lc2gh-bg-top), var(--lc2gh-bg-bottom));
          box-shadow: 0 4px 14px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.06);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        #${AI_PANEL_ID} .__lc2gh_ai_toggle:hover {
          transform: scale(1.06); box-shadow: 0 6px 18px rgba(0,0,0,0.5), 0 0 0 1px var(--lc2gh-accent);
        }
        #${AI_PANEL_ID} .__lc2gh_ai_toggle span { transition: transform 0.2s ease; display: block; width: 100%; height: 100%; }
        #${AI_PANEL_ID} .__lc2gh_ai_toggle.__lc2gh_ai_open span { transform: rotate(18deg); }
        #${AI_PANEL_ID} .__lc2gh_ai_body {
          /* A tall body pushes this fixed-position panel's TOP above the
             viewport (it's anchored by "bottom", so it grows upward) - a
             position:fixed element that overflows the viewport this way is
             not reachable by scrolling the page, unlike normal content. Capping
             max-height to the actual available space, not a fixed px value,
             is what keeps the header and the start of long results reachable. */
          display: none; width: 300px; max-height: min(440px, calc(100vh - 100px));
          overflow-y: auto; box-sizing: border-box;
          background: linear-gradient(180deg, var(--lc2gh-bg-top), var(--lc2gh-bg-bottom));
          color: var(--lc2gh-text); border-radius: 12px; padding: 0 16px 14px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.06);
          opacity: 0; transform: translateY(6px) scale(0.98);
          transition: opacity 0.16s ease, transform 0.16s ease;
        }
        #${AI_PANEL_ID} .__lc2gh_ai_body.__lc2gh_ai_open { display: block; opacity: 1; transform: translateY(0) scale(1); }
        #${AI_PANEL_ID} .__lc2gh_ai_header {
          position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between;
          margin: 0 -16px 12px; padding: 14px 16px 10px; border-bottom: 1px solid var(--lc2gh-border);
          background: var(--lc2gh-bg-top); border-radius: 12px 12px 0 0;
        }
        #${AI_PANEL_ID} .__lc2gh_ai_title { font-weight: 600; }
        #${AI_PANEL_ID} .__lc2gh_ai_provider { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--lc2gh-text-dim); }
        #${AI_PANEL_ID} .__lc2gh_ai_provider_dot { width: 6px; height: 6px; border-radius: 50%; background: var(--lc2gh-accent); }
        #${AI_PANEL_ID} .__lc2gh_ai_section { margin-bottom: 14px; }
        #${AI_PANEL_ID} .__lc2gh_ai_section:last-child { margin-bottom: 0; }
        #${AI_PANEL_ID} .__lc2gh_ai_section_head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        #${AI_PANEL_ID} .__lc2gh_ai_section_label { display: flex; align-items: center; gap: 6px; font-weight: 600; }
        #${AI_PANEL_ID} .__lc2gh_ai_dots { display: flex; gap: 4px; }
        #${AI_PANEL_ID} .__lc2gh_ai_dots span {
          width: 6px; height: 6px; border-radius: 50%; background: transparent;
          box-shadow: inset 0 0 0 1px var(--lc2gh-text-dim);
        }
        #${AI_PANEL_ID} .__lc2gh_ai_dots span.__lc2gh_ai_dot_filled { background: var(--lc2gh-accent); box-shadow: none; }
        #${AI_PANEL_ID} button.__lc2gh_ai_action {
          width: 100%; padding: 7px 10px; border: 1px solid var(--lc2gh-border); border-radius: 6px;
          background: rgba(255,255,255,0.03); color: var(--lc2gh-text); cursor: pointer;
          font-size: 12.5px; font-weight: 500; text-align: left; box-sizing: border-box;
          transition: background 0.12s ease, border-color 0.12s ease;
        }
        #${AI_PANEL_ID} button.__lc2gh_ai_action:hover:not(:disabled) {
          background: rgba(255,161,22,0.08); border-color: rgba(255,161,22,0.4);
        }
        #${AI_PANEL_ID} button.__lc2gh_ai_action:disabled { opacity: 0.5; cursor: default; }
        #${AI_PANEL_ID} .__lc2gh_ai_result {
          display: none; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--lc2gh-border);
          white-space: pre-wrap; color: var(--lc2gh-text-dim); font-size: 12.5px;
        }
        #${AI_PANEL_ID} .__lc2gh_ai_result.__lc2gh_ai_has_content { display: block; }
        #${AI_PANEL_ID} .__lc2gh_ai_result.__lc2gh_ai_error { color: var(--lc2gh-danger); }
        #${AI_PANEL_ID} .__lc2gh_ai_result code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          background: rgba(255,161,22,0.12); color: var(--lc2gh-accent); padding: 1px 4px; border-radius: 4px; font-size: 12px;
        }
        #${AI_PANEL_ID} .__lc2gh_ai_truncated_note {
          margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--lc2gh-border);
          font-size: 11px; font-style: italic; color: var(--lc2gh-accent);
        }
        @keyframes __lc2gh_ai_pulse { 0%, 80%, 100% { opacity: .25 } 40% { opacity: 1 } }
        #${AI_PANEL_ID} .__lc2gh_ai_loading_dots span { animation: __lc2gh_ai_pulse 1.1s infinite ease-in-out; }
        #${AI_PANEL_ID} .__lc2gh_ai_loading_dots span:nth-child(2) { animation-delay: 0.15s; }
        #${AI_PANEL_ID} .__lc2gh_ai_loading_dots span:nth-child(3) { animation-delay: 0.3s; }
      `;
      document.head.appendChild(style);

      const panel = document.createElement('div');
      panel.id = AI_PANEL_ID;

      const toggle = document.createElement('button');
      toggle.className = '__lc2gh_ai_toggle';
      toggle.title = 'LeetCode AI Assistant';
      toggle.appendChild(iconSpan(SPARK_SVG, 20));

      const body = document.createElement('div');
      body.className = '__lc2gh_ai_body';

      const header = document.createElement('div');
      header.className = '__lc2gh_ai_header';
      const title = document.createElement('span');
      title.className = '__lc2gh_ai_title';
      title.textContent = 'AI Assistant';
      const providerRow = document.createElement('span');
      providerRow.className = '__lc2gh_ai_provider';
      const providerDot = document.createElement('span');
      providerDot.className = '__lc2gh_ai_provider_dot';
      const providerLabel = document.createElement('span');
      providerLabel.textContent = 'Groq';
      providerRow.appendChild(providerDot);
      providerRow.appendChild(providerLabel);
      header.appendChild(title);
      header.appendChild(providerRow);

      function buildSection(iconSvg, labelText) {
        const section = document.createElement('div');
        section.className = '__lc2gh_ai_section';
        const head = document.createElement('div');
        head.className = '__lc2gh_ai_section_head';
        const label = document.createElement('span');
        label.className = '__lc2gh_ai_section_label';
        label.appendChild(iconSpan(iconSvg, 14));
        const labelText_ = document.createElement('span');
        labelText_.textContent = labelText;
        label.appendChild(labelText_);
        head.appendChild(label);
        section.appendChild(head);
        return { section, head };
      }

      const complexitySection = buildSection(CHEVRON_SVG, 'Complexity');
      const complexityBtn = document.createElement('button');
      complexityBtn.className = '__lc2gh_ai_action';
      complexityBtn.textContent = 'Analyze';
      const complexityResult = document.createElement('div');
      complexityResult.className = '__lc2gh_ai_result';
      complexitySection.section.appendChild(complexityBtn);
      complexitySection.section.appendChild(complexityResult);

      const hintSection = buildSection(BULB_SVG, 'Hint');
      const hintDots = document.createElement('span');
      hintDots.className = '__lc2gh_ai_dots';
      const hintDotEls = [0, 1, 2].map(() => {
        const d = document.createElement('span');
        hintDots.appendChild(d);
        return d;
      });
      hintSection.head.appendChild(hintDots);
      const hintBtn = document.createElement('button');
      hintBtn.className = '__lc2gh_ai_action';
      hintBtn.textContent = 'Get hint';
      const hintResult = document.createElement('div');
      hintResult.className = '__lc2gh_ai_result';
      hintSection.section.appendChild(hintBtn);
      hintSection.section.appendChild(hintResult);

      body.appendChild(header);
      body.appendChild(complexitySection.section);
      body.appendChild(hintSection.section);
      panel.appendChild(toggle);
      panel.appendChild(body);
      document.body.appendChild(panel);

      function renderHintDots(level) {
        hintDotEls.forEach((d, i) => d.classList.toggle('__lc2gh_ai_dot_filled', i < level));
      }

      function updateHintButton(level) {
        renderHintDots(level);
        if (level >= MAX_HINT_LEVEL) {
          hintBtn.textContent = 'All hints used';
          hintBtn.disabled = true;
        } else {
          hintBtn.textContent = level > 0 ? 'Next hint' : 'Get hint';
          hintBtn.disabled = false;
        }
      }

      function ensureHintState() {
        window.__leetcodePush.hintLevel = window.__leetcodePush.hintLevel || {};
      }

      function refreshHintUI() {
        ensureHintState();
        const key = currentProblemKey();
        updateHintButton(window.__leetcodePush.hintLevel[key] || 0);
      }

      function refreshProviderIndicator() {
        if (!isChromeAvailable()) return;
        try {
          chrome.storage.sync.get(['aiProvider'], ({ aiProvider }) => {
            const isOpenAI = aiProvider === 'openai';
            providerLabel.textContent = isOpenAI ? 'OpenAI' : 'Groq';
            providerDot.style.background = isOpenAI ? 'var(--lc2gh-accent-openai)' : 'var(--lc2gh-accent)';
          });
        } catch (e) { /* non-critical, panel still works */ }
      }
      refreshProviderIndicator();
      try {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'sync' && changes.aiProvider) refreshProviderIndicator();
        });
      } catch (e) { /* non-critical */ }

      function clearResult(el) {
        el.classList.remove('__lc2gh_ai_has_content', '__lc2gh_ai_error');
        el.innerHTML = '';
      }

      function setLoading(el, label) {
        el.classList.remove('__lc2gh_ai_error');
        el.classList.add('__lc2gh_ai_has_content');
        el.innerHTML = `${escapeHtml(label)}<span class="__lc2gh_ai_loading_dots"><span>.</span><span>.</span><span>.</span></span>`;
      }

      function setResult(el, text, isError, truncated) {
        el.classList.toggle('__lc2gh_ai_error', !!isError);
        el.classList.add('__lc2gh_ai_has_content');
        el.innerHTML = formatAIText(text)
          + (truncated ? '<div class="__lc2gh_ai_truncated_note">Cut off at the token limit - the model had more to say.</div>' : '');
      }

      toggle.addEventListener('click', () => {
        const willOpen = !body.classList.contains('__lc2gh_ai_open');
        toggle.classList.toggle('__lc2gh_ai_open', willOpen);
        body.classList.toggle('__lc2gh_ai_open', willOpen);
        if (willOpen) refreshHintUI();
      });

      complexityBtn.addEventListener('click', () => {
        if (!isChromeAvailable()) { setResult(complexityResult, 'Extension APIs unavailable.', true); return; }
        const sol = getSolution();
        if (!sol || !sol.code) {
          setResult(complexityResult, 'Could not read code from the editor. Make sure a solution is open.', true);
          return;
        }
        complexityBtn.disabled = true;
        setLoading(complexityResult, 'Analyzing');
        chrome.runtime.sendMessage(
          { action: 'analyzeComplexity', code: sol.code, description: sol.description, lang: sol.lang },
          (response) => {
            complexityBtn.disabled = false;
            if (chrome.runtime.lastError) { setResult(complexityResult, 'Error: ' + chrome.runtime.lastError.message, true); return; }
            if (!response || !response.success) {
              setResult(complexityResult, (response && response.error) || 'Failed to analyze complexity.', true);
              return;
            }
            setResult(complexityResult, response.result, false, response.truncated);
          }
        );
      });

      hintBtn.addEventListener('click', () => {
        if (!isChromeAvailable()) { setResult(hintResult, 'Extension APIs unavailable.', true); return; }
        const sol = getSolution();
        const key = (sol && sol.problemTitle) || '__unknown_problem__';
        ensureHintState();
        const level = nextHintLevel(window.__leetcodePush.hintLevel[key] || 0);
        window.__leetcodePush.hintLevel[key] = level;
        renderHintDots(level);
        hintBtn.disabled = true;
        setLoading(hintResult, 'Thinking');
        chrome.runtime.sendMessage(
          { action: 'getHint', description: sol ? sol.description : '', code: sol ? sol.code : '', level },
          (response) => {
            if (chrome.runtime.lastError) { updateHintButton(level); setResult(hintResult, 'Error: ' + chrome.runtime.lastError.message, true); return; }
            if (!response || !response.success) {
              updateHintButton(level - 1 >= 0 ? level - 1 : 0);
              setResult(hintResult, (response && response.error) || 'Failed to get a hint.', true);
              return;
            }
            updateHintButton(level);
            setResult(hintResult, response.hint, false, response.truncated);
          }
        );
      });
    } catch (e) {
      console.warn('[LeetCode Extension] AI panel injection failed:', e);
    }
  }

  injectAIPanel();

  // The AI panel (below) writes AI-generated text into the page, and any text
  // update to an existing DOM node fires as a childList mutation (old text node
  // removed, new one added). Without this guard, a hint or complexity result
  // that happens to contain a word like "Accepted" or "Wrong Answer" would
  // falsely trigger the accepted-detection logic below.
  function isInsideAIPanel(node) {
    let el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    while (el) {
      if (el.id === AI_PANEL_ID) return true;
      el = el.parentElement;
    }
    return false;
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length === 0) continue;
      for (const node of m.addedNodes) {
        try {
          if (isInsideAIPanel(node)) continue;
          const text = node && node.textContent ? node.textContent : '';
          if (/Accepted/i.test(text)) { 
            console.log('[LeetCode Extension] MutationObserver detected "Accepted" in DOM');
            try { trySendIfAccepted(); } catch (e) { console.error('[LeetCode Extension] trySendIfAccepted invocation error:', e); } 
            return; 
          }
          if (/(Wrong Answer|Wrong|Runtime Error|Time Limit Exceeded|Compile Error)/i.test(text)) {
            console.log('[LeetCode Extension] Submission failed, clearing pending state');
            const sol = getSolution(); 
            if (sol) { 
              const key = `${sol.problemTitle}::${sol.lang}`; 
              window.__leetcodePush.pending.delete(key); 
              delete window.__leetcodePush.metadata[key]; 
            } else { 
              window.__leetcodePush.pending.delete('__unknown__'); 
              delete window.__leetcodePush.metadata['__unknown__']; 
            }
          }
        } catch (e) { /* ignore parsing errors */ }
      }
    }
  });
  try { observer.observe(document.body, { childList: true, subtree: true }); } catch (e) { console.warn('observer.observe failed:', e); }
  window.addEventListener('load', () => { try { setTimeout(trySendIfAccepted, 500); } catch (e) { /* ignore */ } });

})();

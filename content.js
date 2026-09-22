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

  function getSolution() {
    const problemTitle = (document.title || '').replace(/\s*-\s*LeetCode.*$/i, '').trim().replace(/\s+/g, '_');
    const lang = getLanguage();
    const descEl = document.querySelector('.question-content, .question-content__JfgR, .content, .description, .question__content, [class*="elfjS"]');
    const description = descEl ? (descEl.innerText || '').trim() : '';

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

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length === 0) continue;
      for (const node of m.addedNodes) {
        try {
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

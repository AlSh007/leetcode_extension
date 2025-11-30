// Content script: detect LeetCode Submit -> Accepted and push solution to GitHub
// - Preserves Monaco editor formatting by reading `.view-line` elements
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
      "div[class*='lang'] button"
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

  function getSolution() {
    let code = null;
    let extractionMethod = 'unknown';
    
    // STRATEGY 1: Access Monaco's internal model API (most reliable - gets complete code in correct order)
    try {
      // Try multiple ways to access Monaco
      let monacoModels = null;
      
      // Method 1a: Direct window.monaco access
      if (window.monaco && window.monaco.editor) {
        monacoModels = window.monaco.editor.getModels();
      }
      
      // Method 1b: Check if monaco is in a different scope
      if (!monacoModels && typeof monaco !== 'undefined' && monaco.editor) {
        monacoModels = monaco.editor.getModels();
      }
      
      // Method 1c: Look for monaco in iframe (some implementations)
      if (!monacoModels) {
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            if (iframe.contentWindow && iframe.contentWindow.monaco && iframe.contentWindow.monaco.editor) {
              monacoModels = iframe.contentWindow.monaco.editor.getModels();
              if (monacoModels && monacoModels.length > 0) break;
            }
          } catch (e) { /* Cross-origin iframe */ }
        }
      }
      
      if (monacoModels && monacoModels.length > 0) {
        code = monacoModels[0].getValue();
        if (code && code.trim().length > 0) {
          extractionMethod = 'monaco-model-api';
          console.log('[LeetCode Extension] ✅ Extracted code via Monaco Model API');
        }
      }
    } catch (e) {
      console.warn('[LeetCode Extension] Monaco Model API not available:', e.message);
    }
    
    // STRATEGY 2: Try to access Monaco editor instance directly
    if (!code) {
      try {
        const editorElements = document.querySelectorAll('.monaco-editor');
        for (const editorEl of editorElements) {
          // Monaco attaches editor instance to DOM element
          const editorInstance = editorEl && editorEl.__monaco_editor;
          if (editorInstance && typeof editorInstance.getValue === 'function') {
            code = editorInstance.getValue();
            if (code && code.trim().length > 0) {
              extractionMethod = 'monaco-instance';
              console.log('[LeetCode Extension] ✅ Extracted code via Monaco Editor Instance');
              break;
            }
          }
        }
      } catch (e) {
        console.warn('[LeetCode Extension] Monaco instance extraction failed:', e.message);
      }
    }
    
    // STRATEGY 3: Read .view-line elements WITH PROPER ORDERING
    if (!code) {
      try {
        const viewLines = document.querySelectorAll('.view-lines .view-line');
        if (viewLines && viewLines.length > 0) {
          // Extract lines with their positions
          const lineData = Array.from(viewLines).map((el, index) => {
            // Try to get line number from various attributes
            const lineNum = el.getAttribute('data-line-number') 
                         || el.getAttribute('aria-label')?.match(/Line (\d+)/)?.[1]
                         || el.style.top; // Monaco uses top position for line ordering
            
            const text = el.innerText || el.textContent || '';
            const cleanText = text.replace(/\u200B/g, ''); // Remove zero-width spaces
            
            return {
              lineNum: lineNum ? parseFloat(lineNum) : index,
              text: cleanText,
              top: parseFloat(el.style.top) || (index * 20), // Fallback to index-based ordering
              element: el
            };
          });
          
          // Sort by top position (Monaco uses CSS top for line positioning)
          lineData.sort((a, b) => a.top - b.top);
          
          // Join the sorted lines
          const lines = lineData.map(item => item.text);
          code = lines.join('\n').replace(/\r\n?/g, '\n').trim();
          
          if (code && code.length > 0) {
            extractionMethod = 'monaco-view-lines-sorted';
            console.log('[LeetCode Extension] ✅ Extracted code via Monaco view-lines (sorted by position)');
          }
        }
      } catch (e) {
        console.warn('[LeetCode Extension] Monaco view-lines extraction failed:', e.message);
      }
    }
    
    // STRATEGY 4: Try textarea (for older LeetCode UI or fallback)
    if (!code) {
      const textarea = document.querySelector('textarea, .CodeMirror textarea, .react-monaco-container textarea');
      if (textarea && (textarea.value || textarea.textContent)) {
        code = (textarea.value || textarea.textContent || '').replace(/\u200B/g, '').replace(/\r\n?/g, '\n').trim();
        if (code && code.length > 0) {
          extractionMethod = 'textarea';
          console.log('[LeetCode Extension] ✅ Extracted code via textarea');
        }
      }
    }
    
    // STRATEGY 5: Try container elements (last resort)
    if (!code) {
      const container = document.querySelector('.view-lines, .monaco-editor, .view-code, .code-textarea, .ace_content');
      if (container) {
        code = (container.textContent || container.innerText || '').replace(/\u200B/g, '').replace(/\r\n?/g, '\n').trim();
        if (code && code.length > 0) {
          extractionMethod = 'container-text';
          console.log('[LeetCode Extension] ⚠️ Extracted code via container (may be incomplete)');
        }
      }
    }
    
    // Validation and logging
    if (!code || code.length === 0) {
      console.error('[LeetCode Extension] ❌ Failed to extract code - all strategies failed');
      return null;
    }
    
    const lineCount = code.split('\n').length;
    const charCount = code.length;
    const codeLines = code.split('\n');
    const firstLine = codeLines[0]?.trim() || '';
    const lastLine = codeLines[lineCount - 1]?.trim() || '';
    
    // DETECT AND FIX REVERSED CODE ORDER
    // Common patterns that should be at the start of code
    const shouldBeFirst = /^(class\s+\w+|def\s+\w+|import\s+|from\s+|package\s+|public\s+class|var\s+|let\s+|const\s+|function\s+)/i;
    // Common patterns that should be at the end
    const shouldBeLast = /^(return\s+|}\s*$|pass\s*$|\)\s*$)/i;
    
    const firstLineMatches = shouldBeFirst.test(firstLine);
    const lastLineMatches = shouldBeLast.test(lastLine);
    const firstLineWrong = shouldBeLast.test(firstLine);
    const lastLineWrong = shouldBeFirst.test(lastLine);
    
    // If code appears to be reversed (last line has class/def, first line has return/})
    if (!firstLineMatches && lastLineWrong && (firstLineWrong || !shouldBeFirst.test(lastLine))) {
      console.warn('[LeetCode Extension] ⚠️ Code appears to be in REVERSE order - auto-correcting!');
      console.log('[LeetCode Extension] Before reversal - First:', firstLine.substring(0, 50), 'Last:', lastLine.substring(0, 50));
      
      // Reverse the lines
      code = codeLines.reverse().join('\n').trim();
      
      const newFirstLine = code.split('\n')[0]?.trim() || '';
      const newLastLine = code.split('\n')[code.split('\n').length - 1]?.trim() || '';
      console.log('[LeetCode Extension] After reversal - First:', newFirstLine.substring(0, 50), 'Last:', newLastLine.substring(0, 50));
      console.log('[LeetCode Extension] ✅ Code order corrected!');
    }
    
    // Log extraction details for debugging
    console.log('[LeetCode Extension] Code Extraction Summary:', {
      method: extractionMethod,
      lines: lineCount,
      characters: charCount,
      firstLine: code.split('\n')[0]?.substring(0, 50) || '',
      lastLine: code.split('\n')[code.split('\n').length - 1]?.substring(0, 50) || ''
    });
    
    // Validate code doesn't look suspiciously incomplete
    if (lineCount < 3 && charCount < 50) {
      console.warn('[LeetCode Extension] ⚠️ Warning: Code seems very short (might be incomplete)');
    }
    
    const problemTitle = (document.title || '').replace(/\s*-\s*LeetCode.*$/i, '').trim().replace(/\s+/g, '_');
    const lang = getLanguage();
    const descEl = document.querySelector('.question-content, .question-content__JfgR, .content, .description, .question__content, [class*="elfjS"]');
    const description = descEl ? (descEl.innerText || '').trim() : '';
    
    return { code, problemTitle, lang, description, extractionMethod, lineCount, charCount };
  }

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
            filename: `${solution.problemTitle}.${solution.lang}`, 
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
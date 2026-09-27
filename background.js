// --- AI features (Groq or OpenAI) -------------------------------------------
// Entirely optional: every handler below checks for a stored API key first and
// responds with `aiUnavailable: true` if it's missing, rather than throwing.
// The GitHub push flow above/below never depends on any of this.
//
// Two providers are supported side by side, picked in the popup via `aiProvider`
// (defaults to "groq" - the free option - if unset or unrecognized). Each has
// its own optional key in storage; only the selected provider's key is used.

const AI_PROVIDERS = {
  groq: {
    // Groq gates/deprecates models with little notice - if this ever 404s with
    // "model_not_found" again, check https://console.groq.com/docs/models for
    // what's currently generally available (not Enterprise-tier-only).
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "openai/gpt-oss-120b",
    keyName: "groqApiKey",
    label: "Groq"
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-5.6-luna",
    keyName: "openaiApiKey",
    label: "OpenAI"
  }
};

function getActiveProvider(stored) {
  const providerId = AI_PROVIDERS[stored.aiProvider] ? stored.aiProvider : "groq";
  const providerConfig = AI_PROVIDERS[providerId];
  return { providerConfig, apiKey: stored[providerConfig.keyName] };
}

function callChatCompletion(providerConfig, apiKey, messages, sendResponse, resultKey) {
  fetch(providerConfig.url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: providerConfig.model, messages, temperature: 0.3, max_tokens: 1500 })
  })
    .then(res => {
      if (!res.ok) return res.text().then(t => { throw new Error(`${providerConfig.label} API failed (${res.status}): ${t}`); });
      return res.json();
    })
    .then(data => {
      const choice = data && data.choices && data.choices[0];
      const content = choice && choice.message && choice.message.content;
      if (!content) throw new Error(`${providerConfig.label} API returned no content`);
      // finish_reason is "length" when the model was cut off by max_tokens and
      // "stop" when it finished on its own - this is what actually tells us
      // whether a short-looking answer is complete or truncated, instead of
      // guessing from word count.
      const truncated = choice.finish_reason === "length";
      sendResponse({ success: true, [resultKey]: content.trim(), truncated });
    })
    .catch(err => {
      console.error(`[LeetCode Extension BG] ${providerConfig.label} API error:`, err);
      sendResponse({ success: false, error: err.message });
    });
}

function handleAnalyzeComplexity(request, sendResponse) {
  const { code, description, lang } = request;
  if (!code || !code.trim()) {
    sendResponse({ success: false, error: "No code to analyze" });
    return;
  }
  chrome.storage.sync.get(["aiProvider", "groqApiKey", "openaiApiKey"], (stored) => {
    const { providerConfig, apiKey } = getActiveProvider(stored);
    if (!apiKey) {
      sendResponse({ success: false, aiUnavailable: true, error: `${providerConfig.label} API key not set. Add one in the extension popup to enable AI features.` });
      return;
    }
    const messages = [
      {
        role: "system",
        content: "You are a precise algorithm complexity analyst. Given a problem description and a code solution, respond with the time complexity and space complexity in Big-O notation, each on its own line, followed by a 1-2 sentence justification. Be concise. Do not restate the code."
      },
      {
        role: "user",
        content: `Problem:\n${description || "(no description captured)"}\n\nLanguage: ${lang || "unknown"}\n\nCode:\n${code}`
      }
    ];
    callChatCompletion(providerConfig, apiKey, messages, sendResponse, "result");
  });
}

function handleGetHint(request, sendResponse) {
  const { description, level, code } = request;
  if (!description || !description.trim()) {
    sendResponse({ success: false, error: "No problem description captured yet - open a problem page first" });
    return;
  }
  chrome.storage.sync.get(["aiProvider", "groqApiKey", "openaiApiKey"], (stored) => {
    const { providerConfig, apiKey } = getActiveProvider(stored);
    if (!apiKey) {
      sendResponse({ success: false, aiUnavailable: true, error: `${providerConfig.label} API key not set. Add one in the extension popup to enable AI features.` });
      return;
    }
    const levelPrompts = {
      1: "Give a level-1 hint: a short conceptual nudge pointing toward the right algorithmic pattern or data structure. Do not name the final approach outright, and do not give code or pseudocode.",
      2: "Give a level-2 hint: describe the general approach and algorithm in plain words, including why it works. Do not give code or pseudocode.",
      3: "Give a level-3 hint: describe the approach in more detail, including the key data structure(s), the main steps, and important edge cases to handle. Still do not give code or pseudocode - describe it in words only."
    };
    const levelPrompt = levelPrompts[level] || levelPrompts[1];
    const messages = [
      {
        role: "system",
        content: `You are a helpful LeetCode tutor giving progressive hints. ${levelPrompt} Never reveal a full solution, working code, or pseudocode, no matter what is asked.`
      },
      {
        role: "user",
        content: `Problem:\n${description}${code ? `\n\nMy current (possibly incomplete) code attempt:\n${code}` : ""}`
      }
    ];
    callChatCompletion(providerConfig, apiKey, messages, sendResponse, "hint");
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzeComplexity") {
    handleAnalyzeComplexity(request, sendResponse);
    return true; // async response
  }
  if (request.action === "getHint") {
    handleGetHint(request, sendResponse);
    return true; // async response
  }

  try {
    if (request.action !== "pushToGitHub") return;

    console.log('[LeetCode Extension BG] Received pushToGitHub request for:', request.filename);
    
    const { filename, code, repo, token, description = "", dirName = "", language = "", metadata = {}, extractionMethod = "", lineCount = 0, charCount = 0 } = request;
    
    // Validate required fields before processing
    if (!code || code.trim().length === 0) {
      console.error('[LeetCode Extension BG] Code is empty, rejecting request');
      sendResponse({ accepted: false, error: 'Code is empty' });
      return;
    }
    
    if (!repo || !token) {
      console.error('[LeetCode Extension BG] Repo or token missing, rejecting request');
      sendResponse({ accepted: false, error: 'Repo or token missing' });
      return;
    }
    
    // Enhanced validation and logging
    const actualLineCount = code.split('\n').length;
    const actualCharCount = code.length;
    const firstLine = code.split('\n')[0]?.substring(0, 60) || '';
    const lastLine = code.split('\n')[actualLineCount - 1]?.substring(0, 60) || '';
    
    console.log('[LeetCode Extension BG] Request validated. Code analysis:', {
      language,
      extractionMethod,
      reportedLines: lineCount,
      actualLines: actualLineCount,
      reportedChars: charCount,
      actualChars: actualCharCount,
      firstLine,
      lastLine
    });
    
    // Python-specific validation
    if (language && language.toLowerCase().includes('python')) {
      const hasIndentation = code.includes('    ') || code.includes('\t');
      const hasDefOrClass = /\b(def|class)\b/.test(code);
      const nonEmptyLines = code.split('\n').filter(line => line.trim().length > 0).length;
      
      console.log('[LeetCode Extension BG] Python validation:', {
        hasIndentation,
        hasDefOrClass,
        nonEmptyLines,
        averageLineLength: Math.round(actualCharCount / actualLineCount)
      });
      
      if (nonEmptyLines > 5 && !hasIndentation) {
        console.warn('[LeetCode Extension BG] ⚠️ WARNING: Python code lacks indentation - may be corrupted!');
      }
      
      if (actualLineCount < 3 && actualCharCount < 50) {
        console.warn('[LeetCode Extension BG] ⚠️ WARNING: Code seems suspiciously short - may be incomplete!');
      }
    }
    
    // Immediately acknowledge receipt so the message channel does not need to stay open.
    // The long-running work is performed asynchronously (fire-and-forget).
    sendResponse({ accepted: true });

    const sanitize = s => (s || "").toString().trim().replace(/[\\\/:?<>|"*#%{}|^~\[\]`]+/g, "_").replace(/\s+/g, "_");
    const safeDir = sanitize(dirName) || "LeetCode_Solutions";
    const safeFilename = sanitize(filename) || `solution.${sanitize(language) || "txt"}`;
    const solutionPath = `${safeDir}/${safeFilename}`;
    const readmePath = `${safeDir}/README.md`;

    const headers = {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    };

    const encode = (str) => btoa(unescape(encodeURIComponent(str || "")));

    function getFileInfo(path) {
      const apiUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
      return fetch(apiUrl, { headers })
        .then(res => {
          if (res.status === 200) return res.json().then(j => ({ exists: true, sha: j.sha }));
          if (res.status === 404) return { exists: false };
          return res.text().then(t => { throw new Error(`GitHub GET failed (${res.status}): ${t}`); });
        });
    }

    // Robust upsert with retry on 409/422 (sha mismatch) and small backoff
    function upsertFile(path, content, message, maxRetries = 4) {
      const apiUrlFor = (p) => `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(p)}`;

      const attempt = (remaining) => {
        return getFileInfo(path)
          .then(info => {
            const body = { message, content: encode(content) };
            if (info.exists) body.sha = info.sha;
            return fetch(apiUrlFor(path), { method: "PUT", headers, body: JSON.stringify(body) })
              .then(res => {
                if (res.ok) return res.json();
                // retry on conflict / validation (sha mismatch) when retries left
                if ((res.status === 409 || res.status === 422) && remaining > 0) {
                  return new Promise(resolve => setTimeout(resolve, 300 + (5 - remaining) * 50))
                    .then(() => attempt(remaining - 1));
                }
                return res.text().then(t => { throw new Error(`GitHub PUT failed (${res.status}): ${t}`); });
              });
          });
      };

      return attempt(maxRetries);
    }

    // Build structured README
    const mdLines = [];
    mdLines.push(`# ${dirName || safeDir}`);
    mdLines.push("");
    if (description) mdLines.push(description, "");
    mdLines.push("---", "");
    mdLines.push("## Metadata", "");
    mdLines.push(`- Language: ${language || "Unknown"}`);
    mdLines.push(`- Difficulty: ${metadata.difficulty || "Unknown"}`);
    mdLines.push(`- Acceptance: ${metadata.acceptance || "N/A"}`);
    mdLines.push(`- Tags: ${(Array.isArray(metadata.tags) ? metadata.tags.join(", ") : (metadata.tags || "N/A"))}`);
    if (metadata.url) mdLines.push(`- URL: ${metadata.url}`);
    mdLines.push("", "## Files", "");
    mdLines.push(`- ${safeFilename}`);
    mdLines.push("");

    const readmeContent = mdLines.join("\n");

    // Perform the network work asynchronously so we don't rely on the message channel lifetime.
    (async () => {
      try {
        console.log('[LeetCode Extension BG] Starting GitHub upsert for:', safeFilename);
        const results = await Promise.all([
          upsertFile(readmePath, readmeContent, `Add/update README for ${safeDir}`),
          upsertFile(solutionPath, code, `Add/update solution ${safeFilename}`)
        ]);
        // Log results to the service worker console for debugging. If desired, store status in chrome.storage.
        console.log('[LeetCode Extension BG] ✅ GitHub upsert completed successfully!', { readme: results[0], solution: results[1] });
      } catch (err) {
        console.error('[LeetCode Extension BG] ❌ GitHub upsert failed:', err);
      }
    })();

  } catch (outerErr) {
    // If immediate sendResponse fails or some synchronous error occurs, log it so user can debug.
    try { console.error('background onMessage handler error', outerErr); } catch (e) {}
  }

  // Do not return true — we already sent a synchronous response and are performing work asynchronously.
});
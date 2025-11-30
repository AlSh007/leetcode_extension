chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
// ...existing code...
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== "pushToGitHub") return;

  const { filename, code, repo, token, description = "", dirName = "", language = "", metadata = {} } = request;

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

  Promise.all([
    upsertFile(readmePath, readmeContent, `Add/update README for ${safeDir}`),
    upsertFile(solutionPath, code, `Add/update solution ${safeFilename}`)
  ])
    .then(([readmeRes, solRes]) => sendResponse({ success: true, data: { readme: readmeRes, solution: solRes } }))
    .catch(err => sendResponse({ success: false, error: err.message || String(err) }));

  return true; // keep message channel open
});
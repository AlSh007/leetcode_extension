// ...existing code...
// Keep track of pending submissions (set when submit clicked) and pushed ones
window.__leetcodePush = window.__leetcodePush || { pending: new Set(), pushed: new Set(), metadata: {} };

function getSolution() {
  // Monaco typically renders code inside elements with class "view-lines"
  const viewLines = document.querySelector(".view-lines");
  if (!viewLines) return null;
  const code = viewLines.innerText || "";
  const problemTitle = document.title.replace(" - LeetCode", "").replace(/\s+/g, "_");
  const lang = document.querySelector("select[data-cy='lang-select']")?.value || "txt";

  // try to capture the question description from common container classes
  const descEl = document.querySelector(".question-content, .question-content__JfgR, .content, .description, .question__content");
  const description = descEl ? (descEl.innerText || "").trim() : "";

  return { code, problemTitle, lang, description };
}

// Best-effort metadata extractor (run on click before LeetCode may mutate the page)
function collectMetadata() {
  const url = location.href;

  // difficulty: search for short text containing Easy/Medium/Hard near top of page
  let difficulty = "";
  const headerCandidates = document.querySelectorAll("h1,h2,h3,div,span");
  for (const el of headerCandidates) {
    const txt = (el.innerText || "").trim();
    if (txt.length > 0 && txt.length < 80) {
      const m = txt.match(/\b(Easy|Medium|Hard)\b/i);
      if (m) { difficulty = m[1]; break; }
    }
  }

  // tags: try several common selectors for topic tags
  const tagEls = document.querySelectorAll(".topic-tags a, .topic-tags .tag, .tags a, .tags .tag, .question-tags a, .question-tags .tag, .tags-item");
  const tags = Array.from(tagEls).map(t => (t.innerText || "").trim()).filter(Boolean);

  // acceptance: look for "Acceptance" label or a percent near the header
  let acceptance = "";
  const accMatch = document.body.innerText.match(/Acceptance\s*[:\s]\s*([\d.]+%)/i) || document.body.innerText.match(/([\d.]+)%\s*(acceptance)?/i);
  if (accMatch) acceptance = accMatch[1];

  return { difficulty, tags, acceptance, url };
}

// Listen for user clicks and mark a pending submission when a "Submit" button is clicked
document.addEventListener("click", (e) => {
  let el = e.target;
  while (el && el !== document) {
    if (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.tagName === "A") {
      const text = (el.innerText || "").trim();
      if (/submit/i.test(text)) {
        const sol = getSolution();
        const key = sol ? `${sol.problemTitle}::${sol.lang}` : "__unknown__";

        // collect metadata now (before LeetCode may change the DOM on submit)
        try {
          const meta = collectMetadata();
          window.__leetcodePush.metadata[key] = meta;
        } catch (_) {
          window.__leetcodePush.metadata[key] = {};
        }

        // allow re-submit to overwrite: clear previous "pushed" marker
        window.__leetcodePush.pushed.delete(key);
        window.__leetcodePush.pending.add(key);

        // avoid stuck pending state; also clear stored metadata on timeout
        setTimeout(() => {
          window.__leetcodePush.pending.delete(key);
          delete window.__leetcodePush.metadata[key];
        }, 30000);
        break;
      }
    }
    el = el.parentElement;
  }
}, true); 

function trySendIfAccepted() {
  // Only proceed when page shows Accepted
  if (!/Accepted/i.test(document.body.innerText)) return;
  const solution = getSolution();
  if (!solution) return;

  const key = `${solution.problemTitle}::${solution.lang}`;

  // Only send if this submission was initiated by a click (pending),
  // and not already pushed for this problem+lang
  const wasPending = window.__leetcodePush.pending.has(key) || window.__leetcodePush.pending.has("__unknown__");
  if (!wasPending) return;
  if (window.__leetcodePush.pushed.has(key)) return;

  // Use metadata captured at click time (falls back to empty object)
  const metadata = window.__leetcodePush.metadata[key] || {};

  chrome.storage.sync.get(["repo", "token"], ({ repo, token }) => {
    if (!repo || !token) {
      console.warn("Repo or token not set in storage");
      // clear pending to avoid repeated attempts
      window.__leetcodePush.pending.delete(key);
      delete window.__leetcodePush.metadata[key];
      return;
    }

    // send description and directory name so background can create a folder + README
    const dirName = solution.problemTitle; // background will sanitize
    chrome.runtime.sendMessage({
      action: "pushToGitHub",
      filename: `${solution.problemTitle}.${solution.lang}`,
      code: solution.code,
      language: solution.lang,
      repo,
      token,
      description: solution.description,
      dirName,
      metadata
    }, response => {
      console.log("pushToGitHub response", response);
      if (response && response.success) {
        window.__leetcodePush.pushed.add(key);
        window.__leetcodePush.pending.delete(key);
        delete window.__leetcodePush.metadata[key];
      } else {
        // keep pending for a short retry window; optionally clear after failure
        setTimeout(() => {
          window.__leetcodePush.pending.delete(key);
          delete window.__leetcodePush.metadata[key];
        }, 10000);
      }
    });
  });
}
// ...existing code...
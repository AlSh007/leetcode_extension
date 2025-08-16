# LeetCode → GitHub Extension

A small Chrome/Chromium extension that watches LeetCode submissions and (on Accepted) pushes the solution into a GitHub repo. For each problem it creates/updates a folder named after the problem and writes:
- `README.md` containing the captured question description and metadata
- the solution file (e.g. `Two_Sum.py`)

Quick links to workspace files:
- [background.js](background.js)
- [content.js](content.js)
- [manifest.json](manifest.json)
- [popup.html](popup.html)
- [popup.js](popup.js)
- [.gitignore](.gitignore)
- [pat.txt](pat.txt)
- icons: [icons/icon16.png](icons/icon16.png), [icons/icon48.png](icons/icon48.png), [icons/icon128.png](icons/icon128.png)

How it works (important symbols)
- Content script detects user submit and captures solution with [`getSolution`](content.js) and metadata with [`collectMetadata`](content.js).
- Submission flow is guarded by [`__leetcodePush`](content.js) pending/pushed state and triggered by [`trySendIfAccepted`](content.js).
- Background service worker upserts files to GitHub via [`getFileInfo`](background.js) and a robust `upsertFile` implementation in [background.js](background.js).

Installation (developer/distribution)
1. Open chrome://extensions
2. Enable "Developer mode"
3. Click "Load unpacked" and select this repository directory

Setup
1. Click the extension action and open the popup (see [popup.html](popup.html)).
2. Enter GitHub repo in the form `username/repo` and a personal access token (PAT) with repo access, then click Save. The popup stores the values via [popup.js](popup.js).

Usage
1. Open a LeetCode problem page.
2. Edit/submit code as usual. When you click the Submit button the extension:
   - collects metadata immediately (so it isn't lost after page mutations) via [`collectMetadata`](content.js),
   - waits for an "Accepted" result (detected in [`trySendIfAccepted`](content.js)),
   - sends a message to the background worker to create/update `DIR/README.md` and `DIR/<solution-file>` (see [background.js](background.js)).

Behavior details
- A folder is implicitly created on GitHub by creating files at `DIR/...` paths.
- Filenames and directory names are sanitized in [background.js](background.js).
- On update, the extension fetches file SHA and performs a PUT; the `upsertFile` logic retries on SHA conflicts.

Troubleshooting
- 409 / SHA mismatch errors:
  - These indicate the local SHA used to update a file does not match the server. The background worker retries automatically. Check the Service Worker console for retries and warnings.
  - Open DevTools → Extensions → Service Worker (for this extension) to inspect logs from [background.js](background.js).
- No pushes at all:
  - Ensure popup saved `repo` and `token` (stored via [popup.js](popup.js)).
  - Confirm PAT in [pat.txt](pat.txt) (if used for testing) has `repo` scope.
  - Check content script logs in page console (open the LeetCode page DevTools) for messages from [content.js](content.js).
- Wrong file content / stale metadata:
  - The content script collects metadata at click time with [`collectMetadata`](content.js) before the page mutates. If metadata is missing, verify the submit button click is recognized (the script listens for elements whose text matches `/submit/i`).

Development notes
- Selectors and DOM structure on LeetCode may change. Adjust the selectors in:
  - [`getSolution`](content.js) — where code and description are scraped
  - [`collectMetadata`](content.js) — for difficulty/tags/acceptance selectors
- To add more metadata to the README, extend the `metadata` object populated in [content.js](content.js) and modify README assembly in [background.js](background.js).

Security & privacy
- The extension requires a GitHub PAT. The token is stored using chrome.storage.sync (see [popup.js](popup.js)). Do not publish your PAT.
- No tokens or code are stored locally by this repo; they are sent to GitHub via the browser extension background worker.

If something fails, check these logs:
- Page console (content script logs): open DevTools on LeetCode page
- Extension service worker console (background.js logs): chrome://extensions → Service worker → Inspect views

License
- Use as you wish. Ensure you do not publish PATs or private repo information.

If you want, I can:
- Add a small tests checklist or example screenshot of the generated folder structure.
- Add stricter language → extension filename mapping (e.g. map "Python3"

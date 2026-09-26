# LeetCode to GitHub Extension

Automatically push your accepted LeetCode solutions to GitHub with complete formatting preservation!

## ✨ Features

- 🚀 **Automatic Push** - Solutions are pushed to GitHub automatically when accepted
- 🎨 **Perfect Formatting** - Preserves Python indentation and all code formatting
- 📝 **Rich Metadata** - Includes problem description, difficulty, tags, and acceptance rate
- 🔄 **Complete Capture** - Reads the whole Monaco buffer, not just the lines on screen
- 🛑 **Fails Loudly** - Refuses to push rather than committing a partial file
- 🐍 **Python-Optimized** - Special validation for Python indentation and structure

## 📋 Table of Contents

- [Installation](#installation)
- [Setup](#setup)
- [Usage](#usage)
- [What Gets Pushed](#what-gets-pushed)
- [AI Features](#-ai-features-optional)
- [Troubleshooting](#troubleshooting)
- [How It Works](#how-it-works)

## 🔧 Installation

### 1. Create GitHub Personal Access Token

1. Go to: [GitHub Settings → Tokens](https://github.com/settings/tokens)
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Give it a name: `LeetCode Extension`
4. Select scope: ✅ **`repo`** (Full control of private repositories)
5. Click **"Generate token"**
6. **COPY THE TOKEN** immediately (you won't see it again!)

### 2. Install the Extension

1. Open Chrome and navigate to: `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `leetcode_extension` folder
5. The extension should appear in your extensions list

### 3. Configure the Extension

1. Click the **extension icon** in Chrome toolbar (puzzle piece icon)
2. Enter your details:
   - **Repository**: `your-username/repo-name` (e.g., `john/leetcode-solutions`)
   - **Token**: Paste your GitHub Personal Access Token
   - **AI provider + key** *(optional)*: pick **Groq** (free, via [console.groq.com](https://console.groq.com/keys)) or **OpenAI** (via [platform.openai.com](https://platform.openai.com/api-keys)) and paste that provider's key to enable the AI features below. Leave both blank and everything else still works exactly the same.
3. Click **"Save"**

✅ You're all set! The extension is now ready to use.

## 🎯 Usage

### Basic Workflow

1. **Navigate** to any LeetCode problem (e.g., https://leetcode.com/problems/two-sum/)
2. **Write** your solution in the code editor
3. **Click Submit** button
4. **Wait** for "Accepted" result
5. **Done!** Check your GitHub repo - the solution is automatically pushed

### Monitoring (Optional)

For debugging or to see what's happening:

1. Open **DevTools** (press `F12`)
2. Go to **Console** tab
3. Look for messages starting with `[LeetCode Extension]`

Expected console output:
```
[LeetCode Extension] 🚀 Submit button clicked!
[LeetCode Extension] Code Extraction Summary: {method: "monaco-model-bridge", lines: 15, editorReportedLines: 15, ...}
[LeetCode Extension] Attempting to push to GitHub...
[LeetCode Extension] ✅ Successfully pushed to GitHub!
```

## 📦 What Gets Pushed?

For each accepted solution, the extension creates a folder in your repository:

```
Make_Sum_Divisible_by_P/
├── Make_Sum_Divisible_by_P.py
└── README.md
```

### Solution File
Your complete code with:
- ✅ Perfect indentation (especially important for Python!)
- ✅ All lines in correct order
- ✅ Proper file extension based on language

### README.md
Auto-generated with:
- Problem title and description
- Difficulty level (Easy/Medium/Hard)
- Tags (Array, Dynamic Programming, etc.)
- Acceptance rate
- Link to original LeetCode problem
- List of solution files

**Example README:**
```markdown
# Make Sum Divisible by P

Given an array of positive integers nums, remove the smallest subarray...

---

## Metadata

- Language: Python
- Difficulty: Medium
- Acceptance: 25.4%
- Tags: Array, Hash Table, Prefix Sum
- URL: https://leetcode.com/problems/make-sum-divisible-by-p/

## Files

- Make_Sum_Divisible_by_P.py
```

## 🤖 AI Features (optional)

A small floating 🤖 button appears on every LeetCode problem page. Click it to expand a panel with two on-demand tools, powered by whichever provider you picked in the popup - [Groq](https://console.groq.com/) (free tier) or OpenAI:

- **Analyze Complexity** — reads whatever code is currently in the editor (draft or accepted, via the same Monaco-bridge extraction used for pushes) and returns its time and space complexity in Big-O notation with a short justification.
- **Hint** — gives a progressive hint for the current problem. Each click escalates: level 1 is a conceptual nudge, level 2 describes the general approach, level 3 adds detail on data structures and edge cases. It's capped at level 3 and never returns code or pseudocode, so it can't spoil the full solution. The level resets automatically when you move to a different problem.

**This is entirely optional.** If no key is configured for the selected provider, clicking either button just shows "\<Provider\> API key not set" in the panel — GitHub pushing, code extraction, and everything else keep working normally regardless.

## 🐛 Troubleshooting

### Code Not Pushing to GitHub

**Check the Service Worker console:**

1. Go to `chrome://extensions/`
2. Find "LeetCode to GitHub" extension
3. Click **"service worker"** (blue link)
4. Look for error messages starting with `[LeetCode Extension BG]`

**Common issues:**

- ❌ **"Repo or token not set"** → Configure extension via popup
- ❌ **"GitHub API failed (401)"** → Invalid/expired token, create a new one
- ❌ **"GitHub API failed (404)"** → Repository doesn't exist or wrong name format
- ❌ **"No pending submission found"** → Must click Submit BEFORE solution is accepted

### Only Part of the Code Was Pushed

This was a real bug, fixed in v1.1. Monaco only keeps DOM nodes for the lines
currently scrolled into view, and the old extractor scraped those nodes — so a
file longer than the editor viewport was pushed truncated. v1.1 reads the editor's
text model instead, via a MAIN-world bridge, and never scrapes the DOM.

If you are on v1.1 and nothing pushes at all, look for:

```
[LeetCode Extension] ❌ Could not read the editor buffer: <reason>
```

| Reason | Meaning |
|---|---|
| `bridge-not-installed` | `monaco-bridge.js` did not load — reload the extension and hard-refresh the page |
| `monaco-not-loaded` | The editor had not mounted yet; resubmit |
| `no-model` / `empty-model` | No editor buffer found, or it was blank |

The extension deliberately pushes nothing in these cases rather than committing a
partial file, because a truncated push looks like a successful one.

### Missing Indentation

If Python code has no indentation, check console for:

```
[LeetCode Extension] ⚠️ WARNING: Python code lacks indentation - may be corrupted!
```

**Solution:** Reload the extension:
1. Go to `chrome://extensions/`
2. Click the reload icon ↻ on "LeetCode to GitHub"
3. Refresh your LeetCode page (`Ctrl+Shift+R`)

### Language Detected as "Comment"

If you see:
```
[LeetCode Extension] ⚠️ Could not detect language, defaulting to py (Python)
```

The extension will use `.py` as default. This is fine if you're coding in Python!

### Nothing Happens

**Checklist:**
- ✅ Extension is enabled in `chrome://extensions/`
- ✅ You clicked **Submit** button (not just "Run")
- ✅ Solution got **"Accepted"** status
- ✅ Repository and token are configured in extension popup
- ✅ GitHub repository exists and token has `repo` permissions

## 🔬 How It Works

### Code Extraction

There is one extraction path, and it reads Monaco's text model — the editor's own
source of truth. It is complete and correctly ordered by construction, regardless
of scroll position.

Getting at it takes a bridge. Chrome runs content scripts in an **isolated world**:
they share the page's DOM but get their own JavaScript globals, so `content.js`
cannot see the page's `monaco` object (nor expando properties that page scripts set
on DOM elements). So:

- **`monaco-bridge.js`** is declared with `"world": "MAIN"` and runs in the page's
  own context, where `monaco` is reachable. It listens for a DOM event and writes a
  JSON snapshot of the model into an inert `<script type="application/json">` node.
- **`content.js`** (isolated world) dispatches that event and reads the node. DOM
  event dispatch is *synchronous* and crosses the world boundary, so the snapshot is
  already fresh when `dispatchEvent()` returns — extraction stays a plain
  synchronous call.

When several Monaco instances are mounted (solution editor, diff views, playground),
the bridge prefers a model attached to a visible editor, then the largest.

**There is no DOM-scraping fallback, by design.** Scraping `.view-line` nodes only
ever yields the lines on screen; committing that is worse than committing nothing,
because a truncated file looks like a successful push.

### Validation

- **Line Count Cross-Check**: Warns if the snapshot disagrees with the model
- **Python Validation**: Verifies indentation and structure
- **Completeness Check**: Warns if code seems too short

### Push Process

1. **Submit Click**: Captures problem metadata
2. **Accepted Detection**: Extracts code using best available method
3. **Validation**: Checks order, indentation, completeness
4. **GitHub API**: Creates/updates folder with solution and README
5. **Confirmation**: Logs success in console

## 📝 Notes

- **Supported Languages**: Python, Java, C++, JavaScript, TypeScript, and all LeetCode languages
- **File Naming**: Problem title with underscores (e.g., `Two_Sum.py`)
- **Updates**: Re-submitting updates the existing file (no duplicates)
- **Privacy**: Token is stored locally in Chrome storage only

## 🧪 Tests

```bash
node test/bridge.test.js
```

No dependencies. The tests load `monaco-bridge.js` and `content.js` into **separate**
JS contexts sharing one DOM, mirroring Chrome's isolated/MAIN world split, and assert
that a 200-line file rendered 20 lines at a time is captured in full.

## 🤝 Contributing

Found a bug or have a suggestion? Feel free to:
- Report issues
- Submit pull requests
- Suggest improvements

## 📄 License

This extension is provided as-is for personal use.

---

**Happy Coding! 🚀**

*Made with ❤️ for LeetCode enthusiasts*


# LeetCode to GitHub Extension

Automatically push your accepted LeetCode solutions to GitHub with complete formatting preservation!

## ✨ Features

- 🚀 **Automatic Push** - Solutions are pushed to GitHub automatically when accepted
- 🎨 **Perfect Formatting** - Preserves Python indentation and all code formatting
- 📝 **Rich Metadata** - Includes problem description, difficulty, tags, and acceptance rate
- 🔄 **Smart Extraction** - Multiple strategies ensure complete code capture
- ✅ **Order Correction** - Automatically detects and fixes reversed code
- 🐍 **Python-Optimized** - Special validation for Python indentation and structure

## 📋 Table of Contents

- [Installation](#installation)
- [Setup](#setup)
- [Usage](#usage)
- [What Gets Pushed](#what-gets-pushed)
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
[LeetCode Extension] ✅ Extracted code via Monaco Model API
[LeetCode Extension] Code Extraction Summary: {method: "monaco-model-api", lines: 15, ...}
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

### Code in Wrong Order

The extension automatically detects and corrects reversed code. If you see:

```
[LeetCode Extension] ⚠️ Code appears to be in REVERSE order - auto-correcting!
[LeetCode Extension] ✅ Code order corrected!
```

This means the extension fixed the line order before pushing to GitHub.

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

### Code Extraction Strategies (in order)

1. **Monaco Model API** (Primary)
   - Accesses Monaco editor's internal data model
   - Returns complete code in correct order
   - Most reliable method

2. **Monaco Editor Instance**
   - Direct access via DOM element property
   - Fallback if global Monaco API unavailable

3. **View-Lines with Sorting**
   - Reads `.view-line` DOM elements
   - Sorts by CSS `top` position for correct order
   - Handles virtual scrolling

4. **Textarea Fallback**
   - For older LeetCode UI
   - Backward compatibility

5. **Container Text**
   - Last resort
   - May be incomplete

### Validation & Auto-Correction

- **Line Order Detection**: Checks if `class`/`def` appear at top
- **Auto-Reversal**: Flips code if detected as backwards
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


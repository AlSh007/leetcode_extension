# LeetCode to GitHub Extension

Automatically push your accepted LeetCode solutions to GitHub with complete formatting preservation!

## ✨ Features

- ✅ **Automatic Push** - Solutions are pushed to GitHub automatically when accepted
- ✅ **Perfect Formatting** - Preserves Python indentation and all code formatting
- ✅ **Rich Metadata** - Includes problem description, difficulty, tags, and acceptance rate
- ✅ **Smart Extraction** - Multiple strategies ensure complete code capture
- ✅ **Order Correction** - Automatically detects and fixes reversed code
- ✅ **Python-Optimized** - Special validation for Python indentation and structure

## ¡ Table of Contents

- [Installation](#installation)
- [Setup](#setup)
- [Usage](#usage)
- [What Gets Pushed](#what-gets-pushed)
- [Troubleshooting](#troubleshooting)
- [How It Works](#how-it-works)

## ¤ Installation

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

## ¡ Usage

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
[LeetCode Extension] ✅ Submit button clicked!
[LeetCode Extension] ✅ Extracted code via Monaco Model API
[LeetCode Extension] Code Extraction Summary: {method: "monaco-model-api", lines: 15, ...}
[LeetCode Extension] Attempting to push to GitHub...
[LeetCode Extension] ✅ Successfully pushed to GitHub!
```

## ¤ What Gets Pushed?

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

## ⃣ Troubleshooting

### Code Not Pushing to GitHub

**Check the Service Worker console:**

1. Go to `chrome://extensions/`
2. Find "LeetCode to GitHub" extension
3. Click **"service worker"** (blue link)
4. Look for error messages starting with `[LeetCode Extension BG]`

**Common issues:**

- Ñ **"Repo or token not set"** → Configure extension via popup

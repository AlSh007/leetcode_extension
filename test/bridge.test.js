// Run with: node test/bridge.test.js   (no dependencies)
//
// Regression test for the truncated-push bug: Monaco only keeps `.view-line`
// nodes for the lines currently scrolled into view, so the old DOM-scraping
// extraction pushed just the visible slice of the file to GitHub.
//
// The two scripts are loaded into SEPARATE vm contexts that share one document
// object, which is what Chrome's isolated/MAIN world split actually looks like:
// distinct JS globals, one DOM. A test that put them in a single context would
// pass even if content.js were still reaching for the page's `monaco` global.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const BRIDGE_SRC = fs.readFileSync(path.join(ROOT, 'monaco-bridge.js'), 'utf8');
const CONTENT_SRC = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

// --- minimal shared DOM ------------------------------------------------------

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.textContent = '';
    this.isConnected = false;
    this.style = {};
    this._rects = [{ width: 800, height: 600 }];
  }
  appendChild(child) {
    this.children.push(child);
    child.isConnected = this.isConnected;
    return child;
  }
  getClientRects() { return this._rects; }
  getAttribute() { return null; }
  get innerText() { return this.textContent; }
}

function makeDocument({ title, viewLines }) {
  const documentElement = new El('html');
  const head = new El('head');
  const body = new El('body');
  documentElement.isConnected = head.isConnected = body.isConnected = true;

  const lineEls = viewLines.map(text => { const el = new El('div'); el.textContent = text; return el; });

  const listeners = new Map();

  function walk(node, fn) {
    fn(node);
    for (const c of node.children) walk(c, fn);
  }

  return {
    title,
    documentElement, head, body,
    createElement: tag => new El(tag),
    getElementById(id) {
      let found = null;
      for (const root of [head, body, documentElement]) {
        walk(root, n => { if (!found && n.id === id) found = n; });
      }
      return found;
    },
    querySelector: () => null,
    // Only the selector the old scraping path used is modelled; everything else
    // (language dropdown, description) resolves empty, as on a bare page.
    querySelectorAll: sel => (sel === '.view-lines .view-line' ? lineEls : []),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(evt) {
      for (const fn of listeners.get(evt.type) || []) fn(evt);
      return true;
    },
  };
}

function fakeModel(code, languageId = 'python') {
  return {
    getValue: () => code,
    getLineCount: () => code.split('\n').length,
    getLanguageId: () => languageId,
  };
}

function fakeEditor(model, { visible = true } = {}) {
  const node = new El('div');
  node.isConnected = visible;
  node._rects = visible ? [{ width: 800, height: 600 }] : [];
  return { getModel: () => model, getDomNode: () => node };
}

// Boots both worlds over one document and returns the isolated world's getSolution.
function boot({ document, monaco, installBridge = true }) {
  const base = () => ({
    document,
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    JSON, Date, Math, String, Number, Object, Array, RegExp, Error, Set, Map,
    CustomEvent: class { constructor(type) { this.type = type; } },
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} },
  });

  if (installBridge) {
    const mainCtx = vm.createContext(Object.assign(base(), { monaco }));
    mainCtx.window = mainCtx;
    vm.runInContext(BRIDGE_SRC, mainCtx, { filename: 'monaco-bridge.js' });
  }

  // Note: no `monaco` here. The isolated world must not be able to see it.
  const isoCtx = vm.createContext(base());
  isoCtx.window = isoCtx;
  isoCtx.addEventListener = () => {};
  vm.runInContext(CONTENT_SRC, isoCtx, { filename: 'content.js' });

  return { getSolution: isoCtx.window.__leetcodePush.__getSolution, isoCtx };
}

// --- fixture: a 200-line file of which only 20 lines are rendered ------------

const FULL_CODE = [
  'class Solution:',
  '    def twoSum(self, nums, target):',
  ...Array.from({ length: 197 }, (_, i) => `        # padding line ${i + 1}`),
  '        return []',
].join('\n');

const TOTAL_LINES = FULL_CODE.split('\n').length;
const RENDERED = FULL_CODE.split('\n').slice(40, 60); // the scrolled-into-view slice

// --- tests -------------------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('the DOM only holds the visible slice (this is the bug being fixed)', () => {
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: RENDERED });
  const scraped = document.querySelectorAll('.view-lines .view-line').map(el => el.textContent).join('\n');
  assert.strictEqual(scraped.split('\n').length, 20);
  assert.ok(TOTAL_LINES > 20, 'fixture must be longer than the viewport');
  assert.ok(!scraped.includes('class Solution:'), 'scraping misses the top of the file');
  assert.ok(!scraped.includes('return []'), 'scraping misses the bottom of the file');
});

test('getSolution returns the complete buffer, not the visible slice', () => {
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: RENDERED });
  const monaco = { editor: { getEditors: () => [fakeEditor(fakeModel(FULL_CODE))] } };
  const { getSolution } = boot({ document, monaco });

  const sol = getSolution();
  assert.strictEqual(sol.extractionMethod, 'monaco-model-bridge');
  assert.strictEqual(sol.code, FULL_CODE);
  assert.strictEqual(sol.lineCount, TOTAL_LINES);
  assert.ok(sol.code.startsWith('class Solution:'));
  assert.ok(sol.code.trimEnd().endsWith('return []'));
  assert.strictEqual(sol.problemTitle, 'Two_Sum');
  assert.strictEqual(sol.monacoLanguageId, 'python');
});

test('falls back to getModels() when getEditors() is unavailable', () => {
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: RENDERED });
  const monaco = { editor: { getModels: () => [fakeModel(FULL_CODE)] } };
  const { getSolution } = boot({ document, monaco });
  assert.strictEqual(getSolution().code, FULL_CODE);
});

test('picks the visible editor over a larger detached one', () => {
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: RENDERED });
  const detached = fakeModel(FULL_CODE + '\n# stale diff view\n'.repeat(50));
  const monaco = { editor: { getEditors: () => [
    fakeEditor(detached, { visible: false }),
    fakeEditor(fakeModel(FULL_CODE), { visible: true }),
  ] } };
  const { getSolution } = boot({ document, monaco });
  assert.strictEqual(getSolution().code, FULL_CODE);
});

test('returns no code when the bridge did not load, rather than a truncated push', () => {
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: RENDERED });
  const { getSolution } = boot({ document, monaco: null, installBridge: false });

  const sol = getSolution();
  assert.strictEqual(sol.code, null);
  assert.strictEqual(sol.bridgeError, 'bridge-not-installed');
  assert.strictEqual(sol.extractionMethod, 'none');
  assert.strictEqual(sol.problemTitle, 'Two_Sum', 'metadata still resolves so the pending key works');
});

test('returns no code when Monaco has not finished loading', () => {
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: [] });
  const { getSolution } = boot({ document, monaco: undefined });

  const sol = getSolution();
  assert.strictEqual(sol.code, null);
  assert.strictEqual(sol.bridgeError, 'monaco-not-loaded');
});

test('an empty editor is not pushed', () => {
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: [] });
  const monaco = { editor: { getEditors: () => [fakeEditor(fakeModel('   \n  \n'))] } };
  const { getSolution } = boot({ document, monaco });

  const sol = getSolution();
  assert.strictEqual(sol.code, null);
  assert.strictEqual(sol.bridgeError, 'empty-model');
});

test('the isolated world cannot see the page monaco global (bridge is load-bearing)', () => {
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: RENDERED });
  const monaco = { editor: { getEditors: () => [fakeEditor(fakeModel(FULL_CODE))] } };
  const { isoCtx } = boot({ document, monaco });
  assert.strictEqual(isoCtx.window.monaco, undefined);
});

test('AI panel injection failing (no addEventListener in this minimal DOM) does not break getSolution', () => {
  // content.js calls injectAIPanel() at load time; it must self-guard so a DOM
  // that doesn't support every method it uses (as here) can't take the whole
  // script down with it.
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: RENDERED });
  const monaco = { editor: { getEditors: () => [fakeEditor(fakeModel(FULL_CODE))] } };
  const { getSolution, isoCtx } = boot({ document, monaco });
  assert.strictEqual(getSolution().code, FULL_CODE);
  assert.strictEqual(typeof isoCtx.window.__leetcodePush.__nextHintLevel, 'function');
});

test('hint level escalates 1 -> 2 -> 3 and then caps at 3', () => {
  const document = makeDocument({ title: 'Two Sum - LeetCode', viewLines: RENDERED });
  const monaco = { editor: { getEditors: () => [fakeEditor(fakeModel(FULL_CODE))] } };
  const { isoCtx } = boot({ document, monaco });
  const nextHintLevel = isoCtx.window.__leetcodePush.__nextHintLevel;

  let level = 0;
  level = nextHintLevel(level); assert.strictEqual(level, 1);
  level = nextHintLevel(level); assert.strictEqual(level, 2);
  level = nextHintLevel(level); assert.strictEqual(level, 3);
  level = nextHintLevel(level); assert.strictEqual(level, 3, 'caps at the max level rather than climbing forever');
});

// --- runner ------------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);

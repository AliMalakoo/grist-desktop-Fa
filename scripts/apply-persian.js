#!/usr/bin/env node
// Prepare the pinned core checkout with the vendored Persian layer.
//
//   node scripts/apply-persian.js           apply the layer, or verify an already prepared tree
//   node scripts/apply-persian.js --check   verify only, never write anything
//
// The layer is pinned to one core commit (the desktop's submodule). It is applied only when the
// tree is clean and the patch matches exactly, so an edited document or a different core version
// is never overwritten silently. Re-running after a successful setup is a no-op.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');

const root = path.resolve(__dirname, '..');
const core = path.join(root, 'core');
const layer = path.join(root, 'localization', 'grist-core-fa');
const stateFile = path.join(core, '.grist-desktop-fa-state.json');
const fonts = path.join(root, 'localization', 'fonts');
const fontDest = path.join(core, 'static', 'vazirmatn');
const checkOnly = process.argv.includes('--check');
// Bumped when the desktop-side hooks below change. A prepared tree with an older value gets the
// (idempotent) hooks applied again instead of requiring a fresh checkout.
const DESKTOP_HOOKS = 3;

const read = p => fs.readFileSync(p, 'utf8');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const fail = message => { throw new Error(message); };
const list = name => read(path.join(layer, 'patch', name)).split(/\r?\n/).filter(Boolean);
const corePath = file => path.join(core, file);
const listFonts = () => fs.readdirSync(fonts).sort();

if (!fs.existsSync(path.join(layer, 'patch', 'fa-modified.patch'))) {
  fail('The vendored Persian layer is missing from localization/grist-core-fa');
}

const base = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: core, encoding: 'utf8'}).trim();
const overlayRevision = read(path.join(layer, 'REVISION')).trim();
const expectedCore = execFileSync('git', ['rev-parse', ':core'], {cwd: root, encoding: 'utf8'}).trim();
if (base !== expectedCore) {
  fail(`The core checkout is at ${base}, but this desktop version pins ${expectedCore}.\n` +
       'Restore the submodule first: git submodule update --init -- core');
}

const files = list('files.txt');
const added = list('added-files.txt');
const modified = list('modified-files.txt');
if (files.length !== new Set(files).size || files.length !== added.length + modified.length) {
  fail('patch/files.txt must list each added and modified file exactly once');
}
for (const file of [...added, ...modified]) {
  if (!files.includes(file)) { fail(`patch/files.txt is missing ${file}`); }
}
for (const file of files) {
  if (!fs.existsSync(path.join(layer, 'overlay', file))) {
    fail(`The vendored overlay is missing ${file}`);
  }
}

// Inputs of the layer itself. The scripts and desktop hooks are deliberately not part of this
// hash: they may be improved without forcing users to throw away a correctly prepared core.
const layerInputs = [path.join(layer, 'REVISION'), path.join(layer, 'UPSTREAM.lock'),
  path.join(layer, 'patch', 'fa-modified.patch'),
  ...['files.txt', 'added-files.txt', 'modified-files.txt'].map(f => path.join(layer, 'patch', f)),
  ...files.map(f => path.join(layer, 'overlay', f)),
  ...listFonts().map(f => path.join(fonts, f))];
const inputHash = crypto.createHash('sha256').update(layerInputs.map(hash).join(':')).digest('hex');

// The localization hook: default the interface to Persian in the desktop app, while an explicit
// account setting or the grist_user_locale cookie keeps winning. The flag is exposed by
// ext/app/electron/preload.ts and is deliberately separate from isRunningUnderElectron, whose
// wider meaning in core would enable untested Electron-only code paths.
const LOCALE_FROM = '    window.navigator.language ||';
const LOCALE_TO = '    (window as any).gristDesktopDefaultLocale || window.navigator.language ||';
// The hook used by the first Persian build; replaced in place when upgrading an existing tree.
const OLD_LOCALE_TO = '    (window.isRunningUnderElectron ? "fa" : window.navigator.language) ||';

// What a file in the core tree must contain after a successful preparation.
function expectedContent(file) {
  const text = read(path.join(layer, 'overlay', file));
  if (file === 'app/client/lib/localization.ts') {
    if (text.split(LOCALE_FROM).length !== 2) {
      fail(`Unexpected contents of ${file} in the overlay; cannot apply the Persian default`);
    }
    return text.replace(LOCALE_FROM, LOCALE_TO);
  }
  return text;
}

const themeReplacements = [
  ['fontFamily: `-apple-system', 'fontFamily: `"Vazirmatn Variable",-apple-system'],
  ['`Liberation Sans,Helvetica,Arial,sans-serif',
    '`"Vazirmatn Variable",Liberation Sans,Helvetica,Arial,sans-serif'],
];
const appHtmlFrom = '<link rel="stylesheet" href="bundle.css">';
const appHtmlTo = '<link rel="stylesheet" href="vazirmatn/vazirmatn.css">\n' +
  '<link rel="stylesheet" href="bundle.css">';

function currentState() {
  if (!fs.existsSync(stateFile)) { return null; }
  try { return JSON.parse(read(stateFile)); } catch (e) { fail(`Cannot read ${stateFile}: ${e.message}`); }
}

function stateProblems(state) {
  if (!state) { return ['the core has not been prepared yet (run yarn run setup)']; }
  const problems = [];
  if (state.base !== base) { problems.push(`it was prepared from core ${state.base}`); }
  if (state.overlay !== overlayRevision) {
    problems.push(`it was prepared from Persian layer ${state.overlay}`);
  }
  if (state.inputHash !== inputHash) { problems.push('the vendored Persian layer has changed'); }
  for (const [file, expectedHash] of Object.entries(state.files || {})) {
    if (!fs.existsSync(corePath(file))) { problems.push(`${file} is missing`); continue; }
    if (hash(corePath(file)) !== expectedHash) { problems.push(`${file} was modified`); }
  }
  return problems;
}

function verifyTree() {
  let problems = 0;
  for (const file of files) {
    const actual = corePath(file);
    if (!fs.existsSync(actual)) { console.error(`MISSING      ${file}`); problems++; continue; }
    if (read(actual) === expectedContent(file)) { continue; }
    console.error(`DIFFERS      ${file}`); problems++;
  }
  const themeFile = corePath('app/common/themes/Base.ts');
  const theme = fs.existsSync(themeFile) ? read(themeFile) : '';
  for (const [, to] of themeReplacements) {
    if (!theme.includes(to)) {
      console.error(`MISSING      ${to.slice(0, 40)}... in app/common/themes/Base.ts`); problems++;
    }
  }
  const htmlFile = corePath('static/app.html');
  const html = fs.existsSync(htmlFile) ? read(htmlFile) : '';
  if (!html.includes('vazirmatn/vazirmatn.css')) {
    console.error('MISSING      Vazirmatn stylesheet in static/app.html'); problems++;
  }
  for (const font of listFonts()) {
    const dest = path.join(fontDest, font);
    if (!fs.existsSync(dest) || hash(dest) !== hash(path.join(fonts, font))) {
      console.error(`MISSING      static/vazirmatn/${font}`); problems++;
    }
  }
  return problems;
}

const state = currentState();
if (checkOnly) {
  const problems = stateProblems(state);
  if (problems.length) { fail(`The prepared core is not valid:\n  - ${problems.join('\n  - ')}`); }
  const mismatches = verifyTree();
  if (mismatches) { fail(`${mismatches} file(s) do not match the Persian layer`); }
  console.log(`Persian layer verified: ${files.length} core files, ${listFonts().length} font files,` +
    ` layer ${overlayRevision.slice(0, 7)}, core ${base.slice(0, 7)}.`);
  process.exit(0);
}

if (state) {
  const problems = stateProblems(state);
  if (problems.length) {
    fail('The prepared core does not match this checkout:\n  - ' + problems.join('\n  - ') +
      '\nRestore a clean core checkout (git submodule update --init -- core) and run setup again.');
  }
  // A newer desktop release may add or change hooks without touching the layer. They are
  // idempotent, so they can be applied on top of an already prepared tree.
  if (state.desktopHooks !== DESKTOP_HOOKS) {
    applyDesktopHooks();
    state.desktopHooks = DESKTOP_HOOKS;
    state.files = snapshotFiles();
    writeState(state);
    console.log('Desktop hooks updated.');
  }
  const mismatches = verifyTree();
  if (mismatches) {
    fail(`${mismatches} file(s) were changed after preparation; refusing to overwrite them.`);
  }
  console.log('Persian layer already prepared and verified.');
  process.exit(0);
}

// Fresh preparation. Refuse to touch a tree that carries the user's own edits, rather than letting
// git apply produce a confusing conflict or, worse, a half-applied layer.
const tracked = [...files, 'app/common/themes/Base.ts', 'static/app.html'];
const dirty = execFileSync('git',
  ['status', '--porcelain', '--untracked-files=no', '--', ...tracked],
  {cwd: core, encoding: 'utf8'}).trim();
if (dirty) {
  fail('The core checkout has local changes in files this edition needs:\n' + dirty +
    '\nCommit or stash them (or restore a clean submodule) before running setup.');
}
for (const file of added) {
  if (fs.existsSync(corePath(file))) { fail(`${file} already exists; refusing to overwrite it`); }
}
if (fs.existsSync(fontDest)) { fail('static/vazirmatn already exists; refusing to overwrite it'); }

// Check the desktop-specific hooks before applying anything, to avoid a half-prepared tree.
const themeFile = corePath('app/common/themes/Base.ts');
const theme = read(themeFile);
for (const [from] of themeReplacements) {
  if (theme.split(from).length !== 2) {
    fail('Unexpected contents of app/common/themes/Base.ts; refusing to modify it');
  }
}
const htmlFile = corePath('static/app.html');
if (read(htmlFile).split(appHtmlFrom).length !== 2) {
  fail('Unexpected contents of static/app.html; refusing to modify it');
}

const patch = path.join(layer, 'patch', 'fa-modified.patch');
execFileSync('git', ['apply', '--check', patch], {cwd: core, stdio: 'inherit'});
execFileSync('git', ['apply', patch], {cwd: core, stdio: 'inherit'});
for (const file of added) {
  const dest = corePath(file);
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  fs.copyFileSync(path.join(layer, 'overlay', file), dest);
}

applyDesktopHooks();
fs.mkdirSync(fontDest, {recursive: true});
for (const file of listFonts()) {
  fs.copyFileSync(path.join(fonts, file), path.join(fontDest, file));
}

const mismatches = verifyTree();
if (mismatches) { fail(`${mismatches} file(s) do not match the Persian layer after applying it`); }

writeState({
  base,
  overlay: overlayRevision,
  layerUrl: 'https://github.com/AliMalakoo/grist-core-fa',
  coreVersion: JSON.parse(read(corePath('package.json'))).version,
  desktopVersion: JSON.parse(read(path.join(root, 'package.json'))).version,
  desktopHooks: DESKTOP_HOOKS,
  inputHash,
  files: snapshotFiles(),
});
console.log(`Persian layer prepared: ${files.length} core files, ${listFonts().length} font files,` +
  ` layer ${overlayRevision.slice(0, 7)}, core ${base.slice(0, 7)}.`);

function applyDesktopHooks() {
  // The default language inside the desktop. The layer's detectCurrentLang() checks this before
  // the browser/OS language, but after an explicit account locale or cookie.
  migrateLocaleHook();
  replaceOnce('app/client/lib/localization.ts', LOCALE_FROM, LOCALE_TO);
  // Vazirmatn is bundled with the app, so Persian text needs no network access. There are two
  // stacks (the interface font and the data font), and each must be handled on its own.
  for (const [from, to] of themeReplacements) {
    replaceOnce('app/common/themes/Base.ts', from, to);
  }
  replaceOnce('static/app.html', appHtmlFrom, appHtmlTo);
}

// Upgrade the hook written by the first Persian build, without needing a clean checkout.
function migrateLocaleHook() {
  const p = corePath('app/client/lib/localization.ts');
  const text = read(p);
  if (text.includes(OLD_LOCALE_TO)) {
    fs.writeFileSync(p, text.replace(OLD_LOCALE_TO, LOCALE_TO));
  }
}

// Idempotent per replacement: if the "to" text is already present, there is nothing to do.
// Otherwise the "from" text must occur exactly once, so an unexpected upstream change is never
// clobbered.
function replaceOnce(file, from, to) {
  const p = corePath(file);
  const text = read(p);
  if (text.includes(to)) { return; }
  if (text.split(from).length !== 2) {
    fail(`Unexpected contents of ${file}; refusing to modify it`);
  }
  fs.writeFileSync(p, text.replace(from, to));
}

function snapshotFiles() {
  return Object.fromEntries([...files,
    'app/common/themes/Base.ts', 'static/app.html',
    ...listFonts().map(f => `static/vazirmatn/${f}`),
  ].map(file => [file, hash(corePath(file))]));
}

function writeState(next) {
  fs.writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n');
}

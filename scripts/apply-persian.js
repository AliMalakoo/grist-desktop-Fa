#!/usr/bin/env node
// Prepare the pinned core checkout. Never overwrite an edited or mismatched tree.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const root = path.resolve(__dirname, '..');
const core = path.join(root, 'core');
const layer = path.join(root, 'localization', 'grist-core-fa');
const stateFile = path.join(core, '.grist-desktop-fa-state.json');
const fonts = path.join(root, 'localization', 'fonts');
const read = p => fs.readFileSync(p, 'utf8');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const fail = message => { throw new Error(message); };
const list = name => read(path.join(layer, 'patch', name)).split(/\r?\n/).filter(Boolean);
const replaceOnce = (file, from, to) => {
  const p = path.join(core, file), text = read(p);
  if (text.split(from).length !== 2) { fail(`Unexpected contents of ${file}; refusing to modify it`); }
  fs.writeFileSync(p, text.replace(from, to));
};
if (!fs.existsSync(path.join(layer, 'patch', 'fa-modified.patch'))) {
  fail('The vendored Persian layer is missing from localization/grist-core-fa');
}
const base = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: core, encoding: 'utf8'}).trim();
const overlay = read(path.join(layer, 'REVISION')).trim();
const expectedCore = execFileSync('git', ['rev-parse', ':core'], {cwd: root, encoding: 'utf8'}).trim();
if (base !== expectedCore) { fail('Core submodule commit does not match the pinned desktop version'); }
const sources = [path.join(layer, 'REVISION'), path.join(layer, 'patch', 'fa-modified.patch'),
  ...['files.txt', 'added-files.txt', 'modified-files.txt'].map(f => path.join(layer, 'patch', f)),
  ...list('added-files.txt').map(f => path.join(layer, 'overlay', f)),
  ...fs.readdirSync(fonts).map(f => path.join(fonts, f)), __filename];
const inputHash = crypto.createHash('sha256').update(sources.map(hash).join(':')).digest('hex');
if (fs.existsSync(stateFile)) {
  const state = JSON.parse(read(stateFile));
  if (state.base !== base || state.overlay !== overlay || state.inputHash !== inputHash ||
      Object.entries(state.files).some(([f, h]) => !fs.existsSync(path.join(core, f)) || hash(path.join(core, f)) !== h)) {
    fail('The prepared core or localization inputs changed. Restore a clean core checkout before preparing again.');
  }
  console.log('Persian layer already prepared and verified.');
  process.exit(0);
}
const added = list('added-files.txt');
for (const file of added) {
  if (fs.existsSync(path.join(core, file))) { fail(`${file} already exists; refusing to overwrite it`); }
}
const fontDest = path.join(core, 'static', 'vazirmatn');
if (fs.existsSync(fontDest)) { fail('static/vazirmatn already exists; refusing to overwrite it'); }
// Check the desktop-specific hooks before applying anything, to avoid a half-prepared tree.
for (const [file, fragment] of [
  ['app/common/themes/Base.ts', 'fontFamily: `-apple-system'],
  ['app/common/themes/Base.ts', '`Liberation Sans,Helvetica,Arial,sans-serif'],
  ['static/app.html', '<link rel="stylesheet" href="bundle.css">'],
]) {
  if (read(path.join(core, file)).split(fragment).length !== 2) {
    fail(`Unexpected contents of ${file}; refusing to modify it`);
  }
}
const patch = path.join(layer, 'patch', 'fa-modified.patch');
execFileSync('git', ['apply', '--check', patch], {cwd: core, stdio: 'inherit'});
execFileSync('git', ['apply', patch], {cwd: core, stdio: 'inherit'});
for (const file of added) {
  const dest = path.join(core, file);
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  fs.copyFileSync(path.join(layer, 'overlay', file), dest);
}
// Respect an explicit account/cookie preference; default only Electron to Persian.
replaceOnce('app/client/lib/localization.ts', '    window.navigator.language ||',
  '    (window.isRunningUnderElectron ? "fa" : window.navigator.language) ||');
replaceOnce('app/common/themes/Base.ts', 'fontFamily: `-apple-system', "fontFamily: `\"Vazirmatn Variable\",-apple-system");
replaceOnce('app/common/themes/Base.ts', '`Liberation Sans,Helvetica,Arial,sans-serif',
  '`"Vazirmatn Variable",Liberation Sans,Helvetica,Arial,sans-serif');
replaceOnce('static/app.html', '<link rel="stylesheet" href="bundle.css">',
  '<link rel="stylesheet" href="vazirmatn/vazirmatn.css">\n<link rel="stylesheet" href="bundle.css">');
fs.mkdirSync(fontDest, {recursive: true});
for (const file of fs.readdirSync(fonts)) { fs.copyFileSync(path.join(fonts, file), path.join(fontDest, file)); }
const files = [...new Set([...list('files.txt'), 'app/common/themes/Base.ts', 'static/app.html',
  ...fs.readdirSync(fonts).map(f => `static/vazirmatn/${f}`)])];
fs.writeFileSync(stateFile, JSON.stringify({base, overlay, inputHash,
  files: Object.fromEntries(files.map(f => [f, hash(path.join(core, f))]))}, null, 2) + '\n');
console.log('Persian layer and offline Vazirmatn fonts prepared.');

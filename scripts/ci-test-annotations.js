#!/usr/bin/env node
// Turn a failed mocha run into GitHub workflow-command annotations.
//
// The raw job log is not always reachable (for example, when Actions' log storage is blocked by a
// proxy), while annotations stay available through the API. This prints one annotation per failing
// test, with the start of its error, so a failure can be diagnosed without the full log.
//
//   node scripts/ci-test-annotations.js /path/to/mocha-output.log [--markdown out.md]
const fs = require('fs');

const file = process.argv[2];
const markdownAt = process.argv.indexOf('--markdown');
const markdownFile = markdownAt >= 0 ? process.argv[markdownAt + 1] : null;
if (!file || !fs.existsSync(file)) { process.exit(0); }

// FORCE_COLOR=1 makes mocha colour even a piped log, and the escape sequences sit between the
// indentation and the numbers our patterns look for.
const text = fs.readFileSync(file, 'utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const escape = value => String(value)
  .replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  .replace(/::/g, ':').replace(/,/g, ' -');

const lines = text.split(/\r?\n/);
// Mocha's spec reporter also numbers the tests while they run ("    1) closes"). The failure
// details start after the "N failing" summary, where each entry begins at two-space indentation.
const failingAt = lines.findIndex(line => /^\s*\d+ failing/.test(line));
const details = failingAt >= 0 ? lines.slice(failingAt) : lines;
const failures = [];
for (let i = 0; i < details.length; i++) {
  const match = /^\s{1,3}(\d+)\) (.+)$/.exec(details[i]);
  if (!match) { continue; }
  let title = match[2];
  let start = i + 1;
  const subtitle = (details[start] || '').trim();
  if (subtitle.endsWith(':') && /^\s{4,}\S/.test(details[start])) {
    title += ' ' + subtitle;
    start++;
  }
  const body = [];
  for (let j = start; j < details.length && body.length < 8; j++) {
    if (/^\s{1,3}\d+\) /.test(details[j])) { break; }
    if (/^\s*$/.test(details[j])) { if (body.length) { break; } else { continue; } }
    body.push(details[j].trim());
  }
  failures.push({title: title.replace(/:+$/, ''), body: body.join('\n')});
}

const summary = lines.filter(line => /^\s*\d+ (passing|failing|pending)/.test(line))
  .map(line => line.trim()).join(' ');
if (summary) { console.log(`::notice title=Test summary::${escape(summary)}`); }
for (const failure of failures.slice(0, 15)) {
  console.log(`::error title=${escape(failure.title.slice(0, 120))}::${escape(failure.body || failure.title)}`);
}
if (failures.length > 15) {
  console.log(`::warning::${failures.length - 15} more failing test(s); see the job log.`);
}

// A pull-request comment keeps the details readable even when the job log cannot be fetched.
if (markdownFile && failures.length) {
  const parts = [`**${summary || 'The browser tests failed.'}**`, ''];
  for (const failure of failures.slice(0, 20)) {
    parts.push(`- **${failure.title}**`, '', '  ```', ...
      (failure.body || '(no error output)').split('\n').map(line => `  ${line}`), '  ```');
  }
  if (failures.length > 20) { parts.push(`- …and ${failures.length - 20} more.`); }
  fs.writeFileSync(markdownFile, parts.flat().join('\n') + '\n');
}

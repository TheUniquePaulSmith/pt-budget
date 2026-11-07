#!/usr/bin/env node
// Heuristic i18n / formatting audit of the lines this branch ADDS (committed
// since the merge-base with the base branch, staged, unstaged, and untracked
// files). It reports candidates, not proof: read each finding in context.
//
//   node .claude/skills/i18n/scripts/audit-diff.mjs [--base=origin/devel/latest] [--strict]
//
// Checks (src/** only, tests and locale bundles excluded):
//   jsx-text        literal text between JSX tags            <Button>Save</Button>
//   string-prop     literal user-facing props                label="Name" placeholder='Search'
//   column-text     literal headerName/label/title keys      { headerName: 'Amount' }
//   hard-locale     Intl / toLocale* with a literal locale    toLocaleString('en-US')
//   hard-currency   literal ISO currency in a formatter       currency: 'USD'
//   console         console.* in src/lib or src/contexts      (use logger.child)
//
// Exit code is 0 unless --strict is passed and something was found.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('--base=')) ?? '--base=origin/devel/latest').slice('--base='.length);
const strict = args.includes('--strict');

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const INCLUDE = /^src\/.*\.(tsx?|jsx?)$/;
const EXCLUDE = /(\.test\.|\.spec\.|^src\/locales\/|^src\/test\/|\.d\.ts$)/;

/** Map of file -> Set of added line numbers (in the working-tree version). */
const added = new Map();
function addLine(file, line) {
  if (!INCLUDE.test(file) || EXCLUDE.test(file)) return;
  if (!added.has(file)) added.set(file, new Set());
  added.get(file).add(line);
}

function collectDiff(diffArgs) {
  let text = '';
  try {
    text = git('diff', '--unified=0', '--no-color', '--no-ext-diff', ...diffArgs, '--', 'src');
  } catch {
    return;
  }
  let file = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < count; i += 1) addLine(file, start + i);
    }
  }
}

let mergeBase = null;
try {
  mergeBase = git('merge-base', base, 'HEAD').trim();
} catch {
  console.error(`warning: could not find merge-base with ${base}; auditing uncommitted changes only`);
}
// Diff the merge-base against the WORKING TREE: committed + staged + unstaged in one pass,
// with line numbers that match the files on disk.
collectDiff(mergeBase ? [mergeBase] : ['HEAD']);
for (const file of git('ls-files', '--others', '--exclude-standard', '--', 'src').split('\n').filter(Boolean)) {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n').length;
  for (let i = 1; i <= lines; i += 1) addLine(file, i);
}

const USER_PROPS = 'label|placeholder|title|helperText|aria-label|alt|tooltip|emptyText|noOptionsText|subheader|description';
const CHECKS = [
  {
    id: 'jsx-text',
    tsxOnly: true,
    // >Some words<  or  >Some words{   — at least one letter run of 2+, not just punctuation/entities
    re: />\s*([A-Za-z][^<>{}=;]*[A-Za-z][^<>{}=;]*?)\s*(<|\{)/,
    skip: (m, line) => /=>|\bextends\b|<[A-Z]\w*(<|,)/.test(line) || /^[A-Z_]+$/.test(m[1].trim()),
  },
  { id: 'string-prop', tsxOnly: true, re: new RegExp(`\\b(${USER_PROPS})=(["'])([^"'{}]*[A-Za-z]{2,}[^"'{}]*)\\2`) },
  { id: 'column-text', re: /\b(headerName|label|title|placeholder|helperText|message)\s*:\s*(['"`])([A-Z][^'"`]*[a-z][^'"`]*)\2/ },
  { id: 'hard-locale', re: /(toLocale(?:String|DateString|TimeString)\(\s*['"`][a-z]{2}|Intl\.(?:NumberFormat|DateTimeFormat|PluralRules|RelativeTimeFormat)\(\s*['"`][a-z]{2})/ },
  { id: 'hard-currency', re: /\bcurrency\s*:\s*['"`][A-Z]{3}['"`]/ },
  { id: 'console', pathRe: /^src\/(lib|contexts)\/(?!logging\/)/, re: /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/ },
];

const findings = [];
for (const [file, lines] of [...added.entries()].sort()) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const source = fs.readFileSync(full, 'utf8').split('\n');
  for (const lineNo of [...lines].sort((a, b) => a - b)) {
    const text = source[lineNo - 1];
    if (text === undefined) continue;
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('import ')) continue;
    if (/i18n-ignore/.test(text)) continue;
    for (const check of CHECKS) {
      if (check.tsxOnly && !file.endsWith('.tsx')) continue;
      if (check.pathRe && !check.pathRe.test(file)) continue;
      const match = check.re.exec(text);
      if (!match || (check.skip && check.skip(match, text))) continue;
      findings.push({ file, line: lineNo, check: check.id, text: trimmed.slice(0, 140) });
    }
  }
}

if (findings.length === 0) {
  console.log(`i18n audit: no candidates in ${added.size} changed file(s) (base ${base}).`);
} else {
  console.log(`i18n audit: ${findings.length} candidate(s) in ${added.size} changed file(s) (base ${base}). Review each one:\n`);
  for (const f of findings) console.log(`${f.file}:${f.line}  [${f.check}]  ${f.text}`);
  console.log(`\nFalse positive? Leave it, or add an "i18n-ignore" comment on that line when the string is not user-facing.`);
}
process.exit(strict && findings.length > 0 ? 1 : 0);

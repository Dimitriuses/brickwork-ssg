// Engine smoke test: builds the bundled example/ site and asserts content-
// agnostic invariants. No test framework; exits non-zero on any failure so CI
// catches regressions. Run with `npm test`.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const siteDir = path.join(root, 'example');
const buildDir = path.join(siteDir, 'build');

let passes = 0;
let failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log(`  ok   ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}
function done() {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

console.log('Smoke test: building example/ site...');
let buildOk = true;
try {
  execSync('node cli.js build --site example', { cwd: root, stdio: 'pipe' });
} catch (e) {
  buildOk = false;
  process.stderr.write(((e.stdout || '') + '').toString());
  process.stderr.write(((e.stderr || '') + '').toString());
}
check('build exits 0', buildOk);

if (!fs.existsSync(buildDir)) {
  check('example/build/ exists', false);
  done();
}

const htmlFiles = fs.readdirSync(buildDir).filter(f => f.endsWith('.html')).map(f => path.join(buildDir, f));
check('build produced HTML pages', htmlFiles.length > 0, `${htmlFiles.length} files`);
check('index.html exists', fs.existsSync(path.join(buildDir, 'index.html')));

const index = fs.existsSync(path.join(buildDir, 'index.html'))
  ? fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8') : '';
check('layout: <header> present', index.includes('<header'));
check('layout: <footer> present', index.includes('<footer'));

const unresolved = [], leftoverComponents = [], badIds = [], backslashes = [], brokenLinks = [], brokenButtons = [];
for (const file of htmlFiles) {
  const base = path.basename(file);
  const visible = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  if (/\{\{[A-Za-z0-9_]+\}\}/.test(visible)) unresolved.push(base);
  if (/\{\{COMPONENT:/.test(visible)) leftoverComponents.push(base);
  for (const m of visible.matchAll(/id="(carousel-[^"]*)"/g)) {
    if (/[ ()A-Z]/.test(m[1])) badIds.push(`${base}:${m[1]}`);
  }
  for (const m of visible.matchAll(/(?:src|href)="([^"]*\\[^"]*)"/g)) backslashes.push(`${base}:${m[1]}`);
  for (const m of visible.matchAll(/href="(product-[^"]+\.html)"/g)) {
    if (!fs.existsSync(path.join(buildDir, m[1]))) brokenLinks.push(`${base} -> ${m[1]}`);
  }
  for (const tag of visible.matchAll(/<a\b[^>]*>/g)) {
    const openTag = tag[0];
    if (!/\bclass="[^"]*\bbtn\b[^"]*"/.test(openTag)) continue;
    const hrefMatch = openTag.match(/\bhref="([^"]*)"/);
    if (!hrefMatch) continue;
    const target = hrefMatch[1].split('#')[0].split('?')[0].trim();
    if (!target) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
    if (!fs.existsSync(path.join(buildDir, target))) brokenButtons.push(`${base} -> ${hrefMatch[1]}`);
  }
}
check('no unresolved {{VAR}} placeholders', unresolved.length === 0, unresolved.slice(0, 5).join(', '));
check('no leftover {{COMPONENT:..}}', leftoverComponents.length === 0, leftoverComponents.slice(0, 5).join(', '));
check('no invalid carousel ids', badIds.length === 0, badIds.slice(0, 5).join(', '));
check('no backslash web paths', backslashes.length === 0, backslashes.slice(0, 5).join(', '));
check('all product links resolve', brokenLinks.length === 0, brokenLinks.slice(0, 5).join(', '));
check('all button links resolve', brokenButtons.length === 0, brokenButtons.slice(0, 10).join(', '));

done();

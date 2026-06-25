// Engine smoke test: builds the bundled example/ site and asserts content-
// agnostic invariants. No test framework; exits non-zero on any failure so CI
// catches regressions. Run with `npm test`.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { standardChecks } = require('../lib/checks');

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

// Reusable, content-agnostic invariants (shared with `ssg test` via lib/checks.js).
for (const r of standardChecks(buildDir)) check(r.name, r.ok, r.detail);

const index = fs.existsSync(path.join(buildDir, 'index.html'))
  ? fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8') : '';
check('index.html exists', fs.existsSync(path.join(buildDir, 'index.html')));
check('layout: <header> present', index.includes('<header'));
check('layout: <footer> present', index.includes('<footer'));

// Phase A: a site-authored component (example/components/pricing) renders with
// its own template + build logic + CSS, resolved site-first by the engine.
check('site component renders (pricing template)', index.includes('<section class="pricing">'));
check('site component build logic ran (PLANS expanded)', index.includes('Basic') && index.includes('Pro'));
check('site component CSS copied', fs.existsSync(path.join(buildDir, 'assets', 'css', 'pricing.css')));
check('site component CSS linked', /assets\/css\/pricing\.css/.test(index));
// Phase B: the site component declares its own sub-component (priceRow) in
// pricing.json, resolved via the dynamic sub-component map.
check('site sub-component renders (declared priceRow)', index.includes('class="price-row"'));
// Phase C: a site-authored generator (example/generators/news.build.js) emits
// pages via generate(ctx); the pricing build script used the helpers (raw) - if
// helpers weren't passed it would have thrown and failed the build.
check('site generator emitted pages', fs.readdirSync(buildDir).some(f => /^news-.*\.html$/.test(f)));

done();

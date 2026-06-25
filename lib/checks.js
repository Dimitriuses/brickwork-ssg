// Reusable, content-agnostic build invariants, shared by the engine smoke test
// (test/smoke.js) and `ssg test`. standardChecks(buildDir) returns an array of
// { name, ok, detail } results.

const fs = require('fs');
const path = require('path');

function standardChecks(buildDir) {
  const results = [];
  const add = (name, ok, detail) => results.push({ name, ok, detail });

  if (!fs.existsSync(buildDir)) {
    add('build/ directory exists', false);
    return results;
  }

  const htmlFiles = fs.readdirSync(buildDir)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(buildDir, f));
  add('build produced HTML pages', htmlFiles.length > 0, `${htmlFiles.length} files`);

  const unresolved = [], leftover = [], badIds = [], backslashes = [], brokenLinks = [], brokenButtons = [];
  for (const file of htmlFiles) {
    const base = path.basename(file);
    const visible = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    if (/\{\{[A-Za-z0-9_]+\}\}/.test(visible)) unresolved.push(base);
    if (/\{\{COMPONENT:/.test(visible)) leftover.push(base);
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
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
      if (!fs.existsSync(path.join(buildDir, target))) brokenButtons.push(`${base} -> ${hrefMatch[1]}`);
    }
  }

  add('no unresolved {{VAR}} placeholders', unresolved.length === 0, unresolved.slice(0, 5).join(', '));
  add('no leftover {{COMPONENT:..}}', leftover.length === 0, leftover.slice(0, 5).join(', '));
  add('no invalid carousel ids', badIds.length === 0, badIds.slice(0, 5).join(', '));
  add('no backslash web paths', backslashes.length === 0, backslashes.slice(0, 5).join(', '));
  add('all product links resolve', brokenLinks.length === 0, brokenLinks.slice(0, 5).join(', '));
  add('all button links resolve', brokenButtons.length === 0, brokenButtons.slice(0, 10).join(', '));
  return results;
}

module.exports = { standardChecks };

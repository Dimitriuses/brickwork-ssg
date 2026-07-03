'use strict';
// Scaffolders for `ssg add <kind> <name>` — the author-new kinds (page / component / generator /
// builder). Each writes minimal starter stubs into the SITE (never clobbering unless force),
// registers where the kind requires it, and returns { created, skipped, registered } (site-relative
// path strings) for the CLI to report through the logger. The fifth kind, `material` (copy an
// engine-catalog material), lives in lib/deploy.js — this module is only the author-new side.
//
// Starter content is centralised in STUBS below: the ONE place to change what a fresh material holds.
// Convention note: components AND pages bundle `style.css` / `script.js` (the engine's asset source
// names — see ASSET_KINDS in build.js), NOT `<name>.css` / `<name>.js`; those are the asset stubs.
// See docs/slim-core-plan.md.

const fs = require('fs');
const path = require('path');
const { createComponents } = require('./components');
const { siteDirs } = require('./dirs');

// ---- Starter stubs (tune fresh-material content here) ------------------------------------------
const STUBS = {
  pageHtml: (name) => `<!-- pages/${name}/${name}.html - this page's content; the layout + components render around it -->
<section class="${name}">
  <h1>${name}</h1>
  <p>New page. Edit <code>pages/${name}/${name}.html</code>.</p>
</section>
`,
  pageJson: (name, layout) => JSON.stringify({
    page: name, title: '', description: '', header_theme: '', layout, components: []
  }, null, 2) + '\n',

  componentHtml: (name) => `<!-- components/${name}/${name}.html - component markup; {{VARS}} are filled by the build -->
<div class="${name}">
  <!-- Edit ${name}.html. Reference config/vars as {{VAR_NAME}}. -->
</div>
`,
  componentJson: () => JSON.stringify({ dependencies: [] }, null, 2) + '\n',

  // style.css / script.js are shared by pages and components (the engine's asset source names).
  styleCss: (name) => `/* ${name} styles - bundled wherever ${name} is used */\n`,
  scriptJs: (name) => `// ${name} script - bundled wherever ${name} is used\n`,

  generator: (name) => `// generators/generate-${name}.js - data-only generator (no templates, no file writes).
// Return one descriptor per item; the engine builds a page from each via its template page.
module.exports = {
  generate(ctx, options) {
    // ctx = { siteRoot, engineRoot, buildDir, lib: { slugify, escapeHtml, raw }, collection }
    // Example:
    //   return ctx.collection.items.map(({ id, item }) => ({
    //     slug: id, title: item.data.name, description: item.data.description, vars: {}
    //   }));
    return [];
  }
};
`,

  builder: (name) => `// ${name}.build.js - build script for the "${name}" component.
// Receives the component's vars; return its HTML. helpers = { slugify, escapeHtml, raw }.
function build(vars, loadComponent, replaceVariables, helpers) {
  return replaceVariables(loadComponent('${name}'), vars);
}

module.exports = { build };
`,

  test: (name) => `// test/${name}.test.js - a site test, run by \`ssg test\` after the build + engine checks.
// ctx = { siteRoot, buildDir, read(relPath), check(name, ok, detail), standardChecks }
module.exports = (ctx) => {
  const html = ctx.read('index.html');
  ctx.check('${name}: homepage renders a <title>', /<title>/.test(html));
};
`,

  // ---- ssg init: a blank, buildable project -----------------------------------------------------
  initConfig: () => JSON.stringify({ site: { name: 'My Brickwork Site' }, nav: [] }, null, 2) + '\n',
  initPackage: (name) => JSON.stringify({
    name: (name || 'my-site').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-site',
    private: true,
    scripts: {
      build: 'node engine/cli.js build',
      test: 'node engine/cli.js test',
      admin: 'node engine/cli.js admin'
    }
  }, null, 2) + '\n',
  initGlobalCss: () => `/* Site theme. Override brickwork's --bw-* CSS variables here (see the engine
   README "Theming"); your values cascade over the engine defaults. */
:root {
  /* --bw-accent: #667eea; */
}
`,
  initGlobalJs: () => `// Site-wide script, loaded on every page.
`,
  initLayout: () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{PAGE_TITLE}} - {{SITE_NAME}}</title>
  <meta name="description" content="{{PAGE_DESCRIPTION}}">
  {{CSS_LINKS}}
</head>
<body>
  <main>{{CONTENT}}</main>
  {{JS_SCRIPTS}}
</body>
</html>
`,
  initIndexJson: () => JSON.stringify({ page: 'index', title: 'Home', description: '', layout: '_layout', components: [] }, null, 2) + '\n',
  initIndexHtml: () => `<section style="max-width: 42rem; margin: 4rem auto; font-family: system-ui, sans-serif; line-height: 1.6;">
  <h1>Welcome to brickwork</h1>
  <p>Your new site builds. Edit <code>pages/index/index.html</code>, add pages with
  <code>ssg add page &lt;name&gt;</code>, and adopt ready-made materials with
  <code>ssg add material &lt;name&gt;</code> (e.g. <code>header</code>, <code>footer</code>, <code>hero</code>).</p>
</section>
`
};

// ---- write helpers -----------------------------------------------------------------------------

// Write one stub file unless it already exists (force overrides); record its site-relative path
// under created/skipped. Honours dryRun (records the path, writes nothing).
function place(absPath, content, ctx) {
  const rel = path.relative(ctx.siteRoot, absPath).replace(/\\/g, '/');
  if (fs.existsSync(absPath) && !ctx.force) { ctx.skipped.push(rel); return; }
  if (!ctx.dryRun) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }
  ctx.created.push(rel);
}

// Merge a { key: value } entry into a JSON registry, preserving existing entries. Records the action
// under registered (or skipped if the same entry is already present).
function registerIn(absPath, key, value, ctx) {
  const rel = path.relative(ctx.siteRoot, absPath).replace(/\\/g, '/');
  let reg = {};
  if (fs.existsSync(absPath)) {
    try { reg = JSON.parse(fs.readFileSync(absPath, 'utf8')) || {}; } catch (e) { reg = {}; }
  }
  if (reg[key] === value) { ctx.skipped.push(`${rel} (${key} already registered)`); return; }
  reg[key] = value;
  if (!ctx.dryRun) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, JSON.stringify(reg, null, 2) + '\n');
  }
  ctx.registered.push(`${rel}: ${key} -> ${value}`);
}

// ---- the author-new kinds ----------------------------------------------------------------------

function scaffoldPage(name, ctx) {
  const layout = ctx.opts.layout || '_layout';
  const dir = path.join(ctx.dirs.pages, name);
  place(path.join(dir, `${name}.html`), STUBS.pageHtml(name), ctx);
  place(path.join(dir, `${name}.json`), STUBS.pageJson(name, layout), ctx);
  place(path.join(dir, 'style.css'), STUBS.styleCss(name), ctx);
  place(path.join(dir, 'script.js'), STUBS.scriptJs(name), ctx);
}

function scaffoldComponent(name, ctx) {
  const folder = ctx.opts.folder || name;
  const dir = path.join(ctx.dirs.components, folder);
  place(path.join(dir, `${name}.html`), STUBS.componentHtml(name), ctx);
  place(path.join(dir, `${name}.json`), STUBS.componentJson(), ctx);
  place(path.join(dir, 'style.css'), STUBS.styleCss(name), ctx);
  place(path.join(dir, 'script.js'), STUBS.scriptJs(name), ctx);
  // --register (with --folder) writes the components/registry.json remap so the build resolves
  // <name> to a non-default folder. Without it, a plain component is discovered by its folder name.
  if (ctx.opts.register) {
    registerIn(path.join(ctx.dirs.components, 'registry.json'), name, folder, ctx);
  }
}

function scaffoldGenerator(name, ctx) {
  // Generators resolve by registry name, so a generator MUST register (unlike page/builder).
  place(path.join(ctx.dirs.generators, `generate-${name}.js`), STUBS.generator(name), ctx);
  registerIn(path.join(ctx.dirs.generators, 'registry.json'), name, `generate-${name}.js`, ctx);
}

function scaffoldBuilder(name, ctx) {
  // A builder attaches a build script to an EXISTING component (site- or engine-resolved — you can
  // override just the build logic of an inherited component). Resolve its folder (registry-aware)
  // and confirm the component resolves at all; error otherwise.
  const C = createComponents({ siteRoot: ctx.siteRoot, engineRoot: ctx.engineRoot });
  const exists = C.resolveComponentFile(name, `${name}.html`) || C.resolveComponentFile(name, `${name}.build.js`);
  if (!exists) {
    throw new Error(`no component "${name}" to attach a builder to (add it first, e.g. ssg add component ${name})`);
  }
  const folder = C.componentFolder(name);
  place(path.join(ctx.dirs.components, folder, `${name}.build.js`), STUBS.builder(name), ctx);
}

function scaffoldTest(name, ctx) {
  // Site tests are discovered by folder (test/*.test.js) — no registry, like page/builder. `test/`
  // is not part of the `dirs` layout (yet), so it stays at the site root.
  place(path.join(ctx.siteRoot, 'test', `${name}.test.js`), STUBS.test(name), ctx);
}

// Scaffold a blank, buildable site into `dir` (ssg init). Reuses place() so it never clobbers unless
// force + honours dryRun. Emits a minimal _layout (no header/footer — a blank project owns nothing
// else; adopt them with `ssg add material`), config/package seeds, global assets, and a welcome index.
// Returns { created, skipped } (site-relative paths).
function scaffoldInit(dir, { force = false, dryRun = false } = {}) {
  const ctx = { siteRoot: dir, force, dryRun, created: [], skipped: [], registered: [] };
  place(path.join(dir, 'package.json'), STUBS.initPackage(path.basename(path.resolve(dir))), ctx);
  place(path.join(dir, 'config.json'), STUBS.initConfig(), ctx);
  place(path.join(dir, 'assets', 'css', 'global.css'), STUBS.initGlobalCss(), ctx);
  place(path.join(dir, 'assets', 'js', 'global.js'), STUBS.initGlobalJs(), ctx);
  place(path.join(dir, 'components', '_layout', '_layout.html'), STUBS.initLayout(), ctx);
  place(path.join(dir, 'pages', 'index', 'index.json'), STUBS.initIndexJson(), ctx);
  place(path.join(dir, 'pages', 'index', 'index.html'), STUBS.initIndexHtml(), ctx);
  return { created: ctx.created, skipped: ctx.skipped };
}

const KINDS = {
  page: scaffoldPage,
  component: scaffoldComponent,
  generator: scaffoldGenerator,
  builder: scaffoldBuilder,
  test: scaffoldTest
};

// Scaffold a material of `kind` named `name` into the site. Returns { created, skipped, registered }
// (site-relative path strings). Throws on an unknown kind, or a builder whose component is missing.
function scaffold(kind, name, { siteRoot, engineRoot, opts = {}, dryRun = false }) {
  const fn = KINDS[kind];
  if (!fn) throw new Error(`unknown scaffold kind "${kind}"`);
  // Resolve the site's dir layout once (config.json `dirs`); scaffolders write into the configured
  // pages/components/generators dirs.
  const ctx = { siteRoot, engineRoot, opts, dryRun, force: opts.force, dirs: siteDirs(siteRoot), created: [], skipped: [], registered: [] };
  fn(name, ctx);
  return { created: ctx.created, skipped: ctx.skipped, registered: ctx.registered };
}

module.exports = { scaffold, scaffoldInit, SCAFFOLD_KINDS: Object.keys(KINDS), STUBS };

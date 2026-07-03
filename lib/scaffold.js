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
  const dir = path.join(ctx.siteRoot, 'pages', name);
  place(path.join(dir, `${name}.html`), STUBS.pageHtml(name), ctx);
  place(path.join(dir, `${name}.json`), STUBS.pageJson(name, layout), ctx);
  place(path.join(dir, 'style.css'), STUBS.styleCss(name), ctx);
  place(path.join(dir, 'script.js'), STUBS.scriptJs(name), ctx);
}

function scaffoldComponent(name, ctx) {
  const folder = ctx.opts.folder || name;
  const dir = path.join(ctx.siteRoot, 'components', folder);
  place(path.join(dir, `${name}.html`), STUBS.componentHtml(name), ctx);
  place(path.join(dir, `${name}.json`), STUBS.componentJson(), ctx);
  place(path.join(dir, 'style.css'), STUBS.styleCss(name), ctx);
  place(path.join(dir, 'script.js'), STUBS.scriptJs(name), ctx);
  // --register (with --folder) writes the components/registry.json remap so the build resolves
  // <name> to a non-default folder. Without it, a plain component is discovered by its folder name.
  if (ctx.opts.register) {
    registerIn(path.join(ctx.siteRoot, 'components', 'registry.json'), name, folder, ctx);
  }
}

function scaffoldGenerator(name, ctx) {
  // Generators resolve by registry name, so a generator MUST register (unlike page/builder).
  place(path.join(ctx.siteRoot, 'generators', `generate-${name}.js`), STUBS.generator(name), ctx);
  registerIn(path.join(ctx.siteRoot, 'generators', 'registry.json'), name, `generate-${name}.js`, ctx);
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
  place(path.join(ctx.siteRoot, 'components', folder, `${name}.build.js`), STUBS.builder(name), ctx);
}

const KINDS = {
  page: scaffoldPage,
  component: scaffoldComponent,
  generator: scaffoldGenerator,
  builder: scaffoldBuilder
};

// Scaffold a material of `kind` named `name` into the site. Returns { created, skipped, registered }
// (site-relative path strings). Throws on an unknown kind, or a builder whose component is missing.
function scaffold(kind, name, { siteRoot, engineRoot, opts = {}, dryRun = false }) {
  const fn = KINDS[kind];
  if (!fn) throw new Error(`unknown scaffold kind "${kind}"`);
  const ctx = { siteRoot, engineRoot, opts, dryRun, force: opts.force, created: [], skipped: [], registered: [] };
  fn(name, ctx);
  return { created: ctx.created, skipped: ctx.skipped, registered: ctx.registered };
}

module.exports = { scaffold, SCAFFOLD_KINDS: Object.keys(KINDS), STUBS };

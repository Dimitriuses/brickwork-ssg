# brickwork-ssg

A tiny, zero-config **static-site generator**. Build pages from reusable HTML
components and content collections — no framework, no client runtime, and zero
runtime dependencies for the build itself.

> Status: **v0.2.0**. One engine builds many sites; a site embeds this engine
> as a **git submodule** and runs it.

> **Provenance:** this repository was extracted from a larger private project and
> later separated into an independent engine. The current commit history does not
> reflect the full development timeline.

## A site is a directory

```
my-site/
├── config.json          # site name, contact, social, nav, logo
├── pages/               # <name>/<name>.json (+ optional <name>.html)
├── assets/              # images, global.css, global.js
└── shared/              # database.json + collections (e.g. products/)
```

## Use it in a site (git submodule)

A site is a separate repo that embeds this engine as a submodule and runs it:

```bash
git submodule add <brickwork-ssg-repo-url> engine   # embed the engine at engine/
git submodule update --init --recursive

node engine/cli.js build                 # build the site (cwd) into build/
node engine/cli.js build --site path     # or build any site directory
node engine/cli.js admin                 # product admin on http://localhost:3000
node engine/cli.js test                  # build + engine checks + site tests
```

Add scripts to your site's `package.json`:

```json
{
  "scripts": {
    "build": "node engine/cli.js build",
    "admin": "node engine/cli.js admin",
    "test": "node engine/cli.js test"
  }
}
```

The build needs **no dependencies**. The admin panel needs the engine's deps —
install them once into the submodule: `npm --prefix engine install`.

**Pin & update the engine** by checking out a release tag inside the submodule:

```bash
git -C engine fetch --tags && git -C engine checkout v0.2.0
git add engine && git commit -m "engine v0.2.0"
```

Clone a site with its engine in one step: `git clone --recurse-submodules <site-url>`.

## What you get

- **Components** — a folder with `<name>.html` (template), optional `style.css`/
  `script.js` (auto-linked only where used), and optional `<name>.build.js` for
  custom logic. Engine ships `header`, `footer`, `hero`, `products`, `faq`,
  `contactIcons`, and a `_layout`.
- **Overrides** — drop a same-named file in your site's `components/` to override
  any engine component or the layout, without forking engine logic.
- **Collections** — `shared/database.json` maps data folders (e.g. `products/`)
  into the build; a template page turns each item into a generated detail page. An optional
  per-collection `data_model` (`{ match, type, copy, required }` per part) both surfaces each
  item to generators (`ctx.collection.items`) and controls which files reach `build/` —
  `copy` defaults **false**, so raw `product.json` stays out of the output (leak control).
- **Safe templating** — values are HTML-escaped by default (`raw()` opt-out),
  ids are slugified, and the build exits non-zero on any page failure.

See [CLAUDE.md](CLAUDE.md) for the full architecture.

## Extending (site-authored)

A site can add its own components, generators, and tests — no engine fork needed:

- **Components** — drop `components/<name>/` (`<name>.html`, optional
  `<name>.build.js`, `<name>.json`, `style.css`/`script.js`) into your site; it's
  resolved **site-first**. Override a single engine file (e.g. `header/header.html`)
  and keep the engine's logic. Declare sub-components in `<name>.json`
  (`"subComponents": ["..."]`) — a sub-component may live in its own nested folder
  (`faq/faq_item/`) with `style.css`/`script.js` the engine bundles for you — and optionally
  map component names to folders in `components/registry.json`. Build scripts receive
  `build(vars, loadComponent, replaceVariables, { slugify, escapeHtml, raw })`.
- **Generators** — a **template page** (a `pages/` config with `generatorOptions`)
  names a data-only generator that returns one descriptor per item; the engine
  assembles a page each. Add `generators/<name>.js` exporting
  `{ generate(ctx, options) }` (returns `[{ slug, title, description, vars }]`) and map
  it in `generators/registry.json`. See [docs/generator-migration.md](docs/generator-migration.md).
- **Tests** — add `test/<name>.test.js` (`module.exports = (ctx) => { ctx.check(...) }`).
  `ssg test` builds the site, runs the engine's **always-on checks** (content-agnostic
  invariants — broken links, unresolved placeholders, leftover `{{COMPONENT}}` — isolated
  from your tests so the site is validated even with no/broken tests), then your tests.
  Opt out per-site with `config.json` `"test": { "engineChecks": false }`.

See [docs/extensibility.md](docs/extensibility.md) for the full design.

## Theming

Component colours are CSS custom properties with the engine defaults as
fallbacks. Override any of them in your site's `assets/css/global.css` `:root`
(it cascades over the engine regardless of load order); unset variables keep the
default. Set the page background with your own `body { background }`.

Defaults:

```css
:root {
  --bw-accent: #667eea;        /* buttons, prices, links, active states */
  --bw-accent-hover: #4f62c1;
  --bw-accent-2: #e07a1f;      /* secondary accent */
  --bw-surface: #013440;       /* card / panel background */
  --bw-surface-alt: #013146;
  --bw-surface-deep: #012530;  /* deepest panels, disabled */
  --bw-border: #e0e0e0;        /* card borders */
  --bw-border-dark: #014b5a;   /* pagination / dark borders */
  --bw-image-bg: #f8f9fa;      /* image placeholder background */
  --bw-text: #cccccc;          /* primary text */
  --bw-text-muted: #999999;    /* secondary text */
  --bw-text-faint: #666666;    /* disabled text */
}
```

## Develop the engine

```bash
npm test                 # builds the bundled example/ site and asserts invariants
```

## License

MIT
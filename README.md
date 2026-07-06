# brickwork-ssg

A tiny, zero-config **static-site generator**. Build pages from reusable HTML
components and content collections — no framework, no client runtime, and zero
runtime dependencies for the build itself.

> Status: **v0.4.0**. One engine builds many sites; a site embeds this engine
> as a **git submodule** and runs it.

> **Provenance:** this repository was extracted from a larger private project and
> later separated into an independent engine. The current commit history does not
> reflect the full development timeline.

## A site is a directory

```
my-site/
├── config.json          # site name, contact, social, nav, logo
├── pages/               # <name>/<name>.json (+ optional <name>.html)
├── components/          # the materials this site owns (see below)
├── assets/              # images, global.css, global.js
└── shared/              # database.json + collections (e.g. products/)
```

The whole workspace is **relocatable** via a `config.json` `dirs` block — `pages`, `components`,
`generators`, `assets`, the build `output`, `test`, and `log` folders, the collections `database` file,
and the `admin` folder. Each defaults to the layout above, so it's optional. For example, to keep source
under `src/` and assets alongside your data:

```json
{ "dirs": { "pages": "src/pages", "components": "src/components", "generators": "src/generators",
            "assets": "shared/assets", "output": "build", "test": "test", "log": "log",
            "database": "shared/database.json", "admin": "shared/admin" } }
```

`dirs.log` is the single source for the log file-sink folder (it supersedes `log.file.dir`), and
`dirs.database` (a **file**, default `shared/database.json`) is where the build and the admin read the
collections DB. `config.json` itself stays at the site root.

## Use it in a site (git submodule)

A site is a separate repo that embeds this engine as a submodule and runs it:

```bash
git submodule add <brickwork-ssg-repo-url> engine   # embed the engine at engine/
git submodule update --init --recursive

node engine/cli.js init [dir]            # scaffold a blank buildable site into dir (default .)
node engine/cli.js init [dir] --template demo   # or scaffold from the demo repo (its files, no history)
node engine/cli.js build                 # build the site (cwd) into build/
node engine/cli.js build --site path     # or build any site directory
node engine/cli.js admin                 # launch the site's admin (data management) on http://localhost:3000
node engine/cli.js test                  # build + engine checks + site tests
node engine/cli.js add <kind> <name>     # scaffold new material: page|component|generator|builder|test
node engine/cli.js add material <name>   # adopt an engine material into the site (--force, --dry-run)
node engine/cli.js add material --all-used   # adopt every material the site uses but inherits
node engine/cli.js add admin             # adopt the (data-model-driven) admin panel into the site
```

**Output** flows through one module: colour-coded (green/amber/red), with `--quiet`/`--verbose`, a
`config.json` `log` block + `--log key=value`, and an optional `jsonl` file sink. **`ssg add`** is a
scaffolding command (à la `ng generate`): `page` / `component` / `generator` / `builder` create new
material with starter stubs (never overwriting unless `--force`; `--dry-run` previews), while
**`material`** *adopts* an existing engine material — copying all its files (incl. nested
sub-components) into your site so you *own* it. `add material --all-used` does that for everything the
site currently inherits; an edited file is reported as **drift**, not overwritten (use `--force`).

| `ssg add <kind> <name>` | creates |
|---|---|
| `page` | `pages/<name>/` — `<name>.html`, `<name>.json` (`--layout=<x>` sets its layout), `style.css`, `script.js` |
| `component` | `components/<name>/` stubs; `--folder=<dir>` relocates + `--register` writes the `components/registry.json` remap |
| `generator` | `generators/generate-<name>.js` (a `generate(ctx, options)` stub) **and** a `generators/registry.json` entry |
| `builder` | `<name>.build.js` inside an **existing** component's folder (errors if that component doesn't exist) |
| `test` | `test/<name>.test.js` — a runnable site-test stub, discovered + run by `ssg test` |
| `material` | copies an engine material into the site — `--all-used`, `--force`, `--dry-run` |
| `admin` | adopts the admin panel into the site (`--folder`, `--force`, `--no-install`) — sets `dirs.admin` + seeds an `admin` block, installs its deps |

Every kind refuses to overwrite an existing file unless `--force`, and never commits — you review the
diff. Starter-stub content lives in one place (`lib/scaffold.js`'s `STUBS` map).

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

The build needs **no dependencies**. The admin panel (Express + Multer) is opt-in: `ssg add admin`
copies it into your site and installs its deps *there* (`--no-install` to skip). `ssg admin` then runs
your site's copy; if none is installed it offers to launch the engine's bundled default.

**Pin & update the engine** by checking out a release tag inside the submodule:

```bash
git -C engine fetch --tags && git -C engine checkout v0.4.0
git add engine && git commit -m "engine v0.4.0"
```

Clone a site with its engine in one step: `git clone --recurse-submodules <site-url>`.

## What you get

- **Components** — a folder with `<name>.html` (template), optional `style.css`/
  `script.js` (auto-linked only where used), and optional `<name>.build.js` for
  custom logic. The engine ships a **catalog** of ready materials (`header`, `footer`,
  `hero`, `products`, `faq`, `contactIcons`, `carousel`, and `_layout`) — a slim core
  no longer resolves them during a build; a site **owns what it uses**, adopting them
  with `ssg add material <name>` (or `--all-used`).
- **Overrides** — drop a same-named file in your site's `components/` to override
  any engine component or the layout, without forking engine logic.
- **Collections** — `shared/database.json` maps data folders (e.g. `products/`)
  into the build; a template page turns each item into a generated detail page. An optional
  per-collection `data_model` (`{ match, type, copy, required }` per part) both surfaces each
  item to generators (`ctx.collection.items`) and controls which files reach `build/` —
  `copy` defaults **false**, so raw `product.json` stays out of the output (leak control).
- **Admin panel** — an optional, **data-model-driven** management UI, adopted with `ssg add admin` (the
  site owns + can edit its copy). It reads each enabled collection's `data_model` and generates CRUD per
  part: object parts become forms (from an optional `schema`, via an extensible field-type registry),
  `paths`/`file_path` parts become file managers. Settings live in a `config.json` `admin` block (or the
  admin's own `admin.json`): it binds **localhost-only by default**, and per-part upload limits
  (`max_count`/`max_size_mb`/`accept`) + `hide` are honoured. See [docs/admin-extension-plan.md](docs/admin-extension-plan.md).
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
  turns each collection item into a page. A generator is **optional**: a `source` + a
  `map` of `$`-paths (plus component `vars` resolved per item, e.g. a `carousel` fed
  `$images`) generates pages with **no JS**. For custom shaping, add `generators/<name>.js`
  exporting `{ generate(ctx, options) }` (returns `[{ slug, title, description, vars }]`)
  and map it in `generators/registry.json`. See [docs/generator-migration.md](docs/generator-migration.md).
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
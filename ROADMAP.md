# Roadmap

What **brickwork-ssg** does today and what is planned. A living document — see
[CLAUDE.md](CLAUDE.md) and [docs/](docs/) for the detail behind each item.

Milestones so far: **v0.1** core build, **v0.2** site extensibility, **v0.3**
page-driven generators.

## Implemented

### Core build
- Zero-dependency static-site generator (Node ≥ 14); a single-pass `build.js` run via
  the `ssg` CLI (`ssg build|test|admin [--site <dir>]`).
- Component model: `{{VAR}}` substitution and `{{COMPONENT:name}}` placement, with a
  master `_layout`.
- `config.json` flattened into uppercase template vars; collections declared in
  `shared/database.json` are copied into `build/<destination>`.
- HTML-**escaped by default** with a `raw()` opt-out; selector-/URL-safe `slugify`;
  `normalizeWebPaths` rewrites `\` → `/` in `src`/`href`/`url(...)`.
- The build **exits non-zero** on any page or generator failure.

### Components & layout
- **Site-first, per-file** component resolution: override a single file (e.g.
  `header/header.html`) and keep the engine's logic, or ship a whole new component.
- `components/registry.json` maps a component name to a folder (relocate a component).
- **Declarative sub-components** via `<name>.json` `"subComponents"`.
- Build scripts receive helpers:
  `build(vars, loadComponent, replaceVariables, { slugify, escapeHtml, raw })`.
- **Theming** by overriding `--bw-*` CSS variables — reskin without editing components.

### Generators — page-driven (v0.3)
- **Template pages**: a `pages/` config carrying a `generatorOptions` object declares a
  generator and how to drive it; the engine assembles one page per item.
- **Data-only generators**: `generate(ctx, options) -> [{ slug, title, description, vars }]`
  (no templates, no page-JSON writes).
- **Name resolution** via `generators/registry.json` (engine + site merged, site wins;
  the mapped file then resolves site-first).
- `ctx.collection = { dir, webPath }` resolved from `generatorOptions.source`.
- **Generalized page assets** (`assetsFrom`): a generated page links its template
  folder's `style.css`/`script.js`.
- **Build-time validation** (loud, build-failing): missing `generator`/`pageName`,
  unknown generator, missing/disabled source collection, and `<page>.html` name collisions.
- A leading `_` is a cosmetic author comment — never used for discovery or output names.
- Built-in `generate-detail.js` (registered as `products` + `custom`) turns a collection
  of item folders into detail pages. See [docs/generator-migration.md](docs/generator-migration.md).

### Content & data
- `products` component with **client-side pagination** (`PRODUCTS_PER_PAGE`).
- **Lazy image loading** (`loading="lazy" decoding="async"`) on product/detail images.

### Tooling & distribution
- `ssg test`: reusable standard checks ([lib/checks.js](lib/checks.js)) plus a site's
  own `test/*.test.js`.
- **Admin server** (Express + Multer) for product/image CRUD (`ssg admin`).
- Consumed by sites as a **git submodule**; GitHub Pages deploy (`submodules: recursive`);
  LF normalization via `.gitattributes`.

## Planned / not yet built

Order is not fixed yet; where items depend on each other it is noted inline.

### Testing & robustness
- **Always-on engine self-checks in `ssg test`** — the engine runs a baseline set of its
  own invariants against the built site on every `ssg test`, independent of whether the
  site defines tests, and isolated from broken site tests. A "foolproof" guarantee the
  site is valid even when the user wrote no tests (or invalid ones). Extends today's
  standard checks ([lib/checks.js](lib/checks.js)).

### Data & generators
- **Data management & leak prevention** — separate *data* from *web assets*, read item
  data **pre-copy**, and add a **controlled `product.json` copy** so raw data isn't shipped
  into `build/` by default. (Today `shared/database.json` + `copyCollections` copy the whole
  folder.)
- **Richer `generatorOptions`, incl. placeholder-data mapping** — beyond
  `generator`/`pageName`/`source`: filters, sort, pagination, and a declarative mapping of
  source data fields → template placeholders. Subsumes "config-supplied title/description"
  and moves more logic out of generator JS into the template config.

### Indexing & build materials
- **`*.json` material indexing** — move from scanning file lists to **registering** build
  materials (components, generators, tests) via `*.json`, for explicit, faster indexing.
  Generalizes/replaces the earlier "`registry.json` restructuring" (kept deliberately small
  so this is cheap). Trade-off to settle: explicit registration vs today's zero-config
  "drop a file and it's found".

### Tooling & distribution
- **Material *deploy* commands** — e.g. `ssg add component <name>` (and generators/tests)
  to scaffold a material into a site from the engine, replacing hand-copied overrides.
  Builds on the material index above (deploy *by name*). Note: a deployed copy still
  diverges from the engine afterward — this makes *adding* ergonomic, it doesn't remove the
  override/sync trade-off.
- **npm-distributed third-party plugins/themes + a plugin registry** — third-party
  distribution, once the in-repo model is proven.

### Pages & assets
- **Selectable pagination modes** — let the site choose **single-page** (client-side, all
  cards rendered; today's behavior) or **multi-page** (build-time HTML splitting across
  several pages, so the HTML stops scaling linearly with item count). Multi-page overlaps
  the generator/template-page model — likely best built on top of it rather than as a
  separate path.
- **Multiple `style.css` / `script.js` files per page folder.**

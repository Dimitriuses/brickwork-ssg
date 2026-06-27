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

### Generators & data
- **Database / collection processing** — separate *data* from *web assets*, read data
  **pre-copy**, and add a **controlled `product.json` copy** so raw item data isn't shipped
  into `build/` by default (leak control). `shared/database.json` and `copyCollections`
  are untouched for now.
- **`registry.json` restructuring** — an evolved/unified registry shape (the current
  generator registry is deliberately kept small so this is cheap to change).
- **Richer `generatorOptions`** — beyond `generator`/`pageName`/`source`: filters, sort,
  pagination.
- **`title`/`description` (and other page fields) as template-config values**, instead of
  being supplied only by the generator.

### Pages & assets
- **Per-page HTML splitting** — build-time pagination across multiple HTML pages for very
  large collections (today pagination is client-side and the page HTML scales linearly
  with item count).
- **Multiple `style.css` / `script.js` files per page folder.**

### Distribution & ecosystem
- **npm-distributed third-party plugins/themes + a plugin registry.** Today a site can
  author its own components and generators in-repo; third-party distribution is a later
  milestone once the in-repo model is proven.

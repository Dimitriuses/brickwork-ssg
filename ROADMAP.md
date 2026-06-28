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
- `ssg test`: the engine's **always-on checks** ([lib/checks.js](lib/checks.js)) — content-
  agnostic invariants run on every test, isolated from site tests, opt-out via `config.json`
  `"test": { "engineChecks": false }` — plus a site's own `test/*.test.js`.
- **Admin server** (Express + Multer) for product/image CRUD (`ssg admin`).
- Consumed by sites as a **git submodule**; GitHub Pages deploy (`submodules: recursive`);
  LF normalization via `.gitattributes`.

## Planned / not yet built

**Suggested sequence** (dependency-driven, not fixed): **1.** data management & leak prevention →
**2.** `*.json` material indexing & folder trees → **3.** richer `generatorOptions` →
**4.** material deploy commands & slim core *(needs 2)*. (Always-on engine self-checks —
formerly step 1 — is **done**; see Implemented.) **Multi-page pagination** is **deferred** —
it needs a window-based generation model (below) and is a large task in its own right.

### Data & generators
- **Data management & leak prevention** — a per-collection **`data_model`** declares each
  item's parts (an object keyed by name, e.g. `images`, `data`), each with **`match`** (a
  glob), **`copy`** (does it reach `build/`), and **`required`** (build error if absent).
  Leak control: mark the `data` part `copy: false` so raw `product.json` never ships to
  `build/`. A **missing `data_model` ⇒ today's behavior** (copy the whole folder) **+ a
  gentle warning** (opt-in). Per-part `copy` defaults **`true`** in this task — it is the
  *mechanism* only; the default flips to **`false`** in *material indexing* (next item),
  where generators gain a source-read so `copy: false` is actually safe to use. **Build-time validation** with clear messages — bad glob,
  required-but-missing (and unknown `type` once typing lands). The engine **reading** items
  and handing generators `ctx.collection.items = [{ data, images }]` belongs to the next
  item (*material indexing*); typed `data` + field→placeholder mapping is **richer
  `generatorOptions`** (Task 4 below).
- **Richer `generatorOptions`, incl. placeholder-data mapping** — beyond
  `generator`/`pageName`/`source`: filters, sort, pagination, and a declarative mapping of
  source data fields → template placeholders. Subsumes "config-supplied title/description"
  and moves more logic out of generator JS into the template config.
- **Window-based (list) generation** *(deferred, large)* — emit a page per *window/slice*
  of a collection (e.g. `shop-2`, `shop-3`), generalizing today's one-item→one-page
  contract. A significant task on its own; the prerequisite for multi-page pagination.
  Postponed until feasible.

### Indexing & build materials
- **`*.json` material indexing & folder trees** — move from scanning file lists to
  **registering** materials (components, generators, tests) via `*.json`, which also enables
  **nested folder trees**: a sub-component lives in its own folder inside its parent (e.g.
  `faq/faq_item`, `products/product_item`) and is *declared* rather than discovered. Because
  it's a real registered material, the **engine bundles its `style.css`/`script.js`** — no
  custom build script needed just to assemble or bundle sub-parts. Generalizes today's
  declarative sub-components + `components/registry.json` folder mapping. Trade-off to
  settle: explicit registration vs today's zero-config "drop a file and it's found".
  Also completes the data side of leak prevention: flips the collection `copy` default to
  **`false`**, reads each item into `ctx.collection.items = [{ data, images }]`, and updates
  generators to populate from source — so `product.json` stops shipping to `build/`.

### Tooling & distribution
- **Material *deploy* commands & a slim core** — `ssg add component <name>` (and
  generators/tests) scaffolds a material into a site from a catalog, **and the engine stops
  shipping example/default materials that every site silently inherits**. This fixes three
  pains: example generators producing pages nobody asked for (no empty-override needed);
  having to dig out and hand-copy a material to edit it; and an engine update to a shared
  material breaking sites. A deployed copy is **owned by the site** (no auto-update — by
  design; this is what removes the override/sync problem). The catalog could live in the
  engine (not auto-built) or in a separate "materials" project (see plugins, below). Builds
  on the material index above (deploy *by name*).
- **`ssg init`** — scaffold a starting project (deploy a baseline set of materials + a
  minimal `config.json`/`pages/`), so a fresh project isn't empty once the core is slim.
- **npm-distributed third-party plugins/themes + a material registry** — third-party/shared
  distribution (e.g. a community "materials" project people add to), once the deploy model
  is proven.

### Pages & assets
- **Selectable pagination modes** — **single-page** (client-side, all cards rendered;
  today's behavior) is available now. **Multi-page** (build-time HTML splitting, so the HTML
  stops scaling linearly with item count) is **deferred**: it needs the *window-based
  generation* model above. The two modes are different mechanisms — single-page is pure
  `script.js`, multi-page is build-time — so this is "two implementations behind one flag".
- **Thin build/generator scripts** — move presentation markup out of the scripts. E.g. the
  carousel-controls HTML now built inside `generate-detail.js` / `products.build.js` moves
  to **client-side `script.js`**, keeping build logic and markup separate.
- **Multiple `style.css` / `script.js` files per page folder.**

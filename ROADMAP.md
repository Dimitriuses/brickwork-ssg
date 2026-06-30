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
- Built-in `generate-detail.js` (registered as `products` + `custom`) turned a collection
  of item folders into detail pages — **retired in v0.4** (see below). See [docs/generator-migration.md](docs/generator-migration.md).

### Data model & generator-free pages (v0.4)
- **Per-collection `data_model`** (`{ match, type, copy, required }` per part) surfaces each
  item to `ctx.collection.items` (`[{ id, item }]`, `item` keyed by part — `item.data` parsed,
  `item.images` web paths) **and** whitelists what reaches `build/`: `copy` defaults **false**
  (leak control — raw `product.json` stays out). Omitted `type`/`required`/`copy` warn (grouped).
- **Generator-optional template pages**: `generatorOptions.map` (`$`-paths into the item, else
  literal) fills placeholders with **no generator**; the same `$`-paths resolve in a template
  page's component `vars` per item (e.g. `carousel` fed `$images`). Bad path → build error; miss → warn.
- **`carousel` component** (slides + thumbnails server-side from `$images`; controls injected
  client-side) — the example product/custom detail pages are now **generator-free** (`source` +
  `map` + `carousel`); `generate-detail.js` retired and the engine registry emptied.
- **Nested sub-component folders** + **bundled sub-component assets** (`style.css`/`script.js`
  collected, copied, linked wherever the parent is used).
- **`helpers.collection(name)`** lets a component build script read the data model (same items as
  generators) instead of raw `build/` files; the `products` grid uses it.
- See [docs/material-indexing-plan.md](docs/material-indexing-plan.md). Both sites (private + demo) were migrated to the data model after v0.4.0; `routing.json` and the build/test output overhaul are now tracked below (Planned).

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

**Suggested sequence** (dependency-driven, not fixed): ~~**1.** data management & leak prevention →
**2.** `*.json` material indexing & folder trees~~ **(both done in v0.4 — see Implemented)** →
**3.** richer `generatorOptions` *(the declarative `map` landed in v0.4; filters/sort/pagination remain)* →
**4.** material deploy commands & slim core *(needs 2)*. (Always-on engine self-checks —
formerly step 1 — is **done**; see Implemented.) **Multi-page pagination** is **deferred** —
it needs a window-based generation model (below) and is a large task in its own right.

### Data & generators
- **✅ Done in v0.4 — Data management & leak prevention** (the `copy:false` default + reads landed
  together with material indexing; see the v0.4 Implemented section). Original write-up kept for
  context: a per-collection **`data_model`** declares each
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
- **✅ Done in v0.4 — `*.json` material indexing & folder trees** (nested/bundled sub-components,
  `copy:false` default, `ctx.collection.items`; see the v0.4 Implemented section). Note: the
  carousel landed as a **top-level** component, not a registered sub-component — the declarative
  sub-component + nested-folder mechanism is what shipped. Original write-up kept for context:
  move from scanning file lists to
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
> Expanded into a detail draft: [docs/tooling-and-distribution-plan.md](docs/tooling-and-distribution-plan.md)
> (deploy/slim-core, `ssg init`, plugins/registry, and the terminal-UX overhaul incl. a traffic-light
> colour system).

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
- **Build/test output overhaul (terminal UX)** — a broader pass over the CLI's build/test output,
  beyond the v0.4 grouped warnings (repeat-count + action text). Make errors/warnings/summaries read
  as clear guidance — consistent prefixes + severity, per-phase grouping, quiet/verbose levels — so
  the output is signal, not noise. (Split out of the [material-indexing plan](docs/material-indexing-plan.md)
  as a separate follow-up.)

### Pages & assets
- **Selectable pagination modes** — **single-page** (client-side, all cards rendered;
  today's behavior) is available now. **Multi-page** (build-time HTML splitting, so the HTML
  stops scaling linearly with item count) is **deferred**: it needs the *window-based
  generation* model above. The two modes are different mechanisms — single-page is pure
  `script.js`, multi-page is build-time — so this is "two implementations behind one flag".
- **Thin build/generator scripts** — move presentation markup out of the scripts. **Partly done
  in v0.4:** the new `carousel` component renders only slides + thumbnails server-side and injects
  the prev/next controls + indicators from its `script.js`. The `products` grid card still builds
  its mini-carousel controls in `products.build.js` — the same treatment remains to be applied there.
- **Multiple `style.css` / `script.js` files per page folder.**
- **`routing.json` — URL → page mapping** *(its own task; deferred)*. Map site URLs to page
  folders and allow **nested output paths** (`shop/product-256`, `app/dashboard`), with link
  resolution/normalization across every page; optionally move `generatorOptions` into the routing
  layer. A distinct, large concern that touches *every* page, not just collections — and it
  collides with today's decision that `generatorOptions` lives in the page config and *marks* a
  template page. Prove the data + indexing tracks first (done in v0.4), then decide whether routing
  earns its complexity; keep `generatorOptions` in the page config until then. (Was Track D of the
  [material-indexing plan](docs/material-indexing-plan.md).)

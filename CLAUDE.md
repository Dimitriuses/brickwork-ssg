# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Build the site (runs `node cli.js build`) into build/
npm test               # Build + smoke test (asserts output invariants; non-zero exit on any page failure)
npm run admin          # Launch the admin (site-owned copy via dirs.admin, else the bundled default)
```

The admin is **adopted per-site** with `ssg add admin` (copies `catalog/admin/` into the site + installs
its deps there); `ssg admin` then runs that copy. The engine keeps a bundled default in `catalog/admin/`
as a fallback (see the Admin panel section).

The engine is invoked through a small CLI, [cli.js](cli.js): `ssg build|admin|test [--site <dir>]`. A **site** is a directory containing `config.json`, `pages/`, `assets/`, `shared/`; the default site is the current directory, so `node cli.js build` ≡ `node build.js`. The npm scripts operate on this repo's own site.

There is no linter or watch mode. After changing anything under `components/`, `generators/`, `pages/`, `assets/`, `config.json`, or `shared/`, re-run `npm run build` (or `npm test`) and open `build/index.html` (or serve `build/` with `python -m http.server 8000`).

The builder has **zero runtime dependencies** — `node build.js` runs on a clean checkout. Only the admin panel needs Express + Multer; `ssg add admin` installs them into the site's own admin copy (`<dirs.admin>/node_modules/`).

> **v0.2 — site extensibility:** a site can author its own components, generators, and tests — site-first per-file resolution (+ `components/registry.json`), declarative sub-components, data-only generators driven by **template pages** and resolved by name (`generators/registry.json`), build-script helpers, and `ssg test`. See [docs/extensibility.md](docs/extensibility.md).
>
> **v0.4 — data model & generator-free detail pages:** per-collection `data_model` (`{ match, type, copy, required }`) both surfaces each item to `ctx.collection.items` and controls which files reach `build/` (`copy` defaults **false** — leak control); a template page with just `source` + `map` (+ component `vars` resolving `$`-paths per item) needs **no generator**; the built-in detail generator was retired in favour of a `carousel` component + `map`; components can read the model via `helpers.collection(name)`. See [docs/material-indexing-plan.md](docs/material-indexing-plan.md) and [docs/generator-migration.md](docs/generator-migration.md).

## Architecture

A custom static-site generator. The build is driven by [build.js](build.js) (entered via [cli.js](cli.js)), run top-to-bottom. There is no framework. Understanding the build order in `build.js` is the key to everything else, because several behaviors depend on it.

### Engine vs. site roots

`build.js` resolves two roots so one engine can build many sites:
- **`ENGINE_ROOT`** (`__dirname`) — shared code: `build.js`, `generators/`, `lib/`, and the **`catalog/`** of deployable materials — components **and** the bundled admin (`catalog/admin/`) (see slim-core note below).
- **`SITE_ROOT`** (`process.cwd()`) — per-site: `config.json`, `pages/`, `assets/`, `shared/` data, `components/` (the materials the site owns), and the `build/` output. **the whole workspace is relocatable** via a `config.json` `dirs` block (`lib/dirs.js`): `pages`/`components`/`generators`/`assets` + the `output`/`test`/`log` folders, plus `database` (the collections DB **file**, default `shared/database.json`) and `admin` (the site-owned admin folder) — defaults to this layout; `dirs.log` supersedes `log.file.dir`; `config.json` stays at the root.

Components resolve **site-first, then engine**, **per file** (`resolveComponentFile`): a site can override just `header/header.html` and keep the engine's `header.build.js`, or ship a whole new component. A site `components/registry.json` may map a component name to a folder. The `ssg` CLI chdir's into the requested `--site` so `SITE_ROOT` = cwd.

> **Slim core (Phase 2, `feat/slim-core`).** The engine's default components now live in **`catalog/`**, not `components/`, and **the build no longer resolves engine defaults** — a site **owns what it uses** and adopts catalog materials with `ssg add material <name>` (or `--all-used`). So file references below that say `components/<x>` are now **`catalog/<x>`** in the engine (a site still uses its own `components/`). An unowned material fails the build with `is not installed — run ssg add material <name>`. This CLAUDE.md predates the move and still says `components/` in places — read those as `catalog/` for engine-shipped materials; a full pass is pending (see docs/slim-core-plan.md).

### Build pipeline (order matters)

1. Load `config.json` and `shared/database.json` (under `SITE_ROOT`).
2. **Flatten config** into uppercase template vars: nested keys join with `_` (e.g. `site.contact.email` → `{{SITE_CONTACT_EMAIL}}`), plus convenience aliases (`{{SITE_NAME}}`, `{{CONTACT_EMAIL}}`, `{{YEAR}}`, …). Arrays (e.g. the top-level `nav`) are kept as-is under their uppercase key (`{{NAV}}`) for build scripts to expand.
3. Wipe and recreate `build/` (the build is **destructive** every run).
4. Copy `assets/images/`, then each engine component's `style.css`/`script.js` into `build/assets/css|js/<component>.css|js`, then each **page folder's** `style.css`/`script.js` into `build/assets/css|js/pages/<page>.css|js` (a leading `_` is stripped). Template-driven pages link their template folder's asset from here.
5. **Copy collections** (see below) into `build/<destination>`.
6. Recursively find `.json` configs under `pages/` and **classify** each: a config carrying a `generatorOptions` object is a **template page** (expanded per item by its named generator — see *Generators* — and **not** built literally); a `_`-prefixed **non-template** config is excluded; the rest are normal pages. Build every normal page and every generated page into `build/<page>.html`. Any failure (including build-time validation) increments an error count and makes the process **exit non-zero**.

Non-obvious constraints:
- The `products` **component** reads its collection from **`build/<destination>`** (e.g. `build/products`), after collections are copied (step 5 before 6) — this is why `PRODUCTS_DIR` defaults to `build/products`. **Generators**, by contrast, get `ctx.collection.items` (the engine resolves these from the **source** per the `data_model`), so they don't read `build/` themselves.
- `findPageFiles` collects **all** `.json` configs; classification (step 6) decides what builds. A template page (has `generatorOptions`) is found regardless of any leading `_`; a `_`-prefixed **non-template** page is excluded. Generated pages are assembled in memory and built directly — there is no scratch dir.
- A `{{COMPONENT:name}}` sitting inside an HTML comment is left untouched (not expanded).

### Components (`components/<name>/`)

A component is a folder. Recognized files:
- `<name>.html` — template with `{{VAR}}` and `{{COMPONENT:other}}` placeholders.
- `style.css` / `script.js` — auto-copied and auto-linked only on pages that use the component.
- `<name>.json` — optional; `{ "dependencies": [...], "subComponents": [...] }`.
- `<name>.build.js` — optional custom logic; **its presence overrides** plain template rendering.

**Build script contract:** `module.exports = { build }` where
`build(vars, loadComponent, replaceVariables, helpers) => htmlString` (`helpers = { slugify, escapeHtml, raw, collection }`).
`helpers.collection(name)` resolves a collection by name to `{ name, destination, items: [{ id, item }] }` — the same data the generators see via `ctx.collection.items` — so a component reads the **data model** instead of raw files under `build/` (which `copy:false` keeps out); the `products` grid uses it. See [components/products/products.build.js](components/products/products.build.js) and [components/contactIcons/contactIcons.build.js](components/contactIcons/contactIcons.build.js) for the pattern. `header`/`footer` are config-driven: their nav links come from the top-level `nav` array and the logo from `site.logo` (via [components/header/header.build.js](components/header/header.build.js) / [components/footer/footer.build.js](components/footer/footer.build.js)).

**Rendering rules** (in `buildComponent`):
- `{{COMPONENT:name}}` is resolved recursively with circular-dependency protection (a cycle emits an HTML comment instead of looping).
- `replaceVariables` (in `build.js`, backed by [lib/html.js](lib/html.js)) **HTML-escapes string/number values by default** and uses a function replacer (so `$` sequences in values are literal). Wrap pre-built HTML in `raw(...)` to insert it verbatim — build scripts do this for assembled fragments (carousels, lists, icons, the page body, css/js link tags). It also **skips arrays** — a list (e.g. `FAQ_ITEMS`) must be expanded by a `.build.js`.
- Sub-components (e.g. `faqItem`→`faq`, `productCard`→`products`) are **declared** in the parent's `<name>.json` (`"subComponents": ["faqItem"]`); the engine scans every component config across both roots to build the map. A sub-component's files resolve either **flat** in the parent folder (`faq/faqItem.html`) or in its **own nested folder** (`faq/faq_item/faq_item.html` + `style.css`/`script.js`) — and when it has its own `style.css`/`script.js` the engine **bundles them** (collected + copied + linked wherever the parent is used), so a sub-component needn't rely on the parent's build script to inline its assets.
- `header` and `footer` render on **every** page regardless of a page's `components` list. `footer` pulls in `contactIcons` via its dependency + a `{{COMPONENT:contactIcons}}` placeholder.

### Pages (`pages/<name>/<name>.json`)

Fields: `page` (output filename), `title`/`description` (page metadata, stay page-level), `layout` — a name **string** *or* a **`{ name, vars }`** object (default `_layout`), the same shape as a components entry, whose `vars` hold layout params like `header_theme` (`"dark"`/`"light"` → `<body data-header-mode>`; a top-level `header_theme` is a deprecated fallback) — and `components: [{ name, vars }]`.

Content body resolution order: explicit `content_file` → inline `content` string → auto-load `<page>.html` from the same folder.

Component **placement**: if the content body contains `{{COMPONENT:name}}`, that component is injected there; otherwise it is prepended to the top of the page. The master template is [catalog/_layout/_layout.html](catalog/_layout/_layout.html) — a first-class component built through `buildComponent`, which places `{{COMPONENT:header}}`, `{{CONTENT}}`, `{{COMPONENT:footer}}` (header/footer are declared `_layout` dependencies in `_layout.json`) and the auto-collected CSS/JS links (`{{CSS_LINKS}}`/`{{JS_SCRIPTS}}`; `{{HEAD_EXTRA}}`/`{{BODY_EXTRA}}` are deprecated aliases still filled with the same value). Its `_layout.build.js` derives `HEADER_MODE` (per-page `header_theme`, default `light`) for the body attribute + the header. Just before write, `normalizeWebPaths` rewrites backslashes to `/` inside `src`/`href`/`url(...)`. Bootstrap 5.3 + Bootstrap Icons load from CDN in the layout.

### Collections & product pages

`shared/database.json` lists collections (`{ name, source, destination, enabled }`); enabled ones are copied from `source` (under `SITE_ROOT`) into `build/<destination>`. A product is a folder containing `product.json` (`name`, `price`, `description`, `details`) plus image files (`.jpg/.png/.gif/.webp`); the first image is the primary.

A collection may add a **`data_model`** that both **controls which item files reach `build/`** (leak control) and **surfaces each item to generators**. It is an object keyed by part name, each `{ match, type, copy, required }`: `match` is an item-relative glob (`*`, `**`, `?`, `{a,b,c}`; see [lib/glob.js](lib/glob.js)); `type` surfaces the part into the item — `object` (file parsed, JSON), `paths` (matched files → web-path array), `file_path` (one path; first sorted if several match); `copy` (**default `false`**) ships the part's files to `build/` only when `true`; `required: true` makes a missing match a **build error**. So `"data": { "match": "product.json", "type": "object", "copy": false }` keeps the raw data out of `build/` while still surfacing it to generators. Items are resolved from the **source** (so reading is independent of `copy`) into `ctx.collection.items` (below). Omitting `copy`/`required`/`type` **warns** (warnings are grouped at the end of the build). A collection **without** a `data_model` copies the whole folder (back-compat) + warns. Shape is validated at build time (bad glob, non-boolean `copy`/`required`, missing required → loud error).

Generation is **declared by template pages**, not auto-run. A **template page** (`pages/<name>/<name>.json` carrying a `generatorOptions` object — see [docs/generator-migration.md](docs/generator-migration.md)) names how to drive it. **`generatorOptions.generator` is optional**: with it, the engine resolves the name via `generators/registry.json` (engine defaults + a site's `generators/registry.json`, site wins; the mapped file then resolves site-first) and runs its **data-only** `generate(ctx, options)` for a list of `{ slug, title, description, vars }` descriptors; **without** it, the engine's built-in path produces one descriptor per collection item, filling `vars` from **`generatorOptions.map`** — `{ "PLACEHOLDER": "$path" }` where a `$`-prefixed value is a path into the item (`$data.name`, `$images`) and anything else is a literal (a bad path → build error with the path; a miss → warning). The same `$`-paths resolve in a template page's **component `vars`** (against the item), so a generated page's components — e.g. a `carousel` taking `$images` — receive per-item data. Either way the engine assembles one page per item: the name comes from `generatorOptions.pageName` (substituting `{slug}`), the template's `<name>.html` is filled with the item's `vars`, and the template's `layout`/`header_theme`/`components` are inherited, then built via the normal page pipeline. `ctx.collection = { options, dir, webPath, items }` is resolved from `generatorOptions.source` (a collection in `shared/database.json`): `items` is `[{ id, item }]` — `id` is the `{slug}` (the item folder name, overridden by `item.data.slug`, slugified via [lib/slugify.js](lib/slugify.js)) and `item` is keyed by `data_model` part (`item.data` parsed, `item.images` web paths). Generators read **`ctx.collection.items`** (the engine surfaces the data from source per the `data_model`); `dir`/`webPath` remain for a custom generator that wants to scan further. The engine ships **no built-in detail generator** — product/custom detail pages are **generator-free** (`source` + `map` + a `carousel` component fed `$images`), the canonical example of the declarative path; their template + detail-page CSS/JS live in the **site** (a `pages/<name>/` template page). The build **fails loud** on a malformed `generatorOptions`, an unknown generator, a missing/disabled source collection, or a `<page>.html` name collision. (History: the pre-0.2 `generateProductPages(outputDir)` export and the interim v0.2 auto-run `generate(ctx)` dispatch were both removed.)

**Products pagination & image loading.** The `products` component takes a `PRODUCTS_PER_PAGE` var (in a page's component `vars`): a positive integer paginates the grid, `0`/unset/invalid disables it. Pagination is **client-side** — every card is rendered at build time; [components/products/script.js](components/products/script.js) reads `data-products-per-page` and slices `.products-grid` into pages with Bootstrap pager controls. All product/detail `<img>` tags carry `loading="lazy" decoding="async"` so off-screen/paginated-away images don't download until shown. The HTML text still scales linearly with product count; per-page HTML splitting is a not-yet-built option.

### Admin panel (`catalog/admin/`)

The admin is a **data-model-driven** Express REST API + a self-contained UI, adopted into a site with **`ssg add admin`** (copies `catalog/admin/` → `dirs.admin` (default `shared/admin`), seeds `dirs.admin` + a minimal `admin` block in `config.json`, and `npm install`s its deps there; `--folder`/`--force`/`--no-install`). `ssg admin` resolves **site-first** — it runs the site's own copy at `dirs.admin`, and if none is installed offers the engine's bundled default (`catalog/admin/`). The adopted copy is **self-contained** (its own `server.js`, `lib/model.js`, `public/` incl. the isomorphic `fieldTypes.js`, and `node_modules`) — it needs nothing from the engine.

It manages the site at the **working directory** (`ROOT_DIR = process.cwd()`), reading the collections DB via **`dirs.database`** (the same file the build reads). For every **enabled** collection it walks the `data_model` and exposes a generic CRUD API — no per-collection code: `object` parts are read/written as JSON (validated against an optional **`schema`** via the field-type registry, [catalog/admin/public/fieldTypes.js](catalog/admin/public/fieldTypes.js)), `paths`/`file_path` parts are file managers. The UI ([catalog/admin/public/](catalog/admin/public/)) generates forms + file managers from `GET /api/collections`. Settings come from `<dirs.admin>/admin.json` (else `config.json.admin`): **`localhost_only`** binds `127.0.0.1` **by default**, plus `port` and per-part upload limits (`max_count`/`max_size_mb`/`accept`) + `hide`; `admin.collections` names are validated against each `data_model` at startup (exit 1 on a typo). Collection visibility is the DB's `enabled` flag (drops it from build **and** admin). Untrusted `:id`/`:filename`/part params are validated against path traversal. It writes directly into the site's collection `source/` and does **not** touch `build/`; run `npm run build` afterward. See [docs/admin-extension-plan.md](docs/admin-extension-plan.md).

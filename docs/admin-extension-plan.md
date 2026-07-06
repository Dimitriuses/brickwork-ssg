# Admin panel extension — implementation plan

> **Status: shipped** (`feat/admin-extension`; Phase 1 on `main`). Engine work + docs done — remaining:
> adopt on the sites (demo end-to-end; private site adds `schema`s). Expands the **Admin panel extension** item in
> [ROADMAP.md](../ROADMAP.md). The admin becomes a **data-management surface derived from each
> collection's `data_model`**, **owned by the site** (adopted via `ssg add admin`), with `database.json`'s
> location made configurable and its own settings/security config. All questions resolved (see
> **Decided (final)**); the **Implementation plan (phases & commits)** is at the bottom.

## The pieces (recommended order 1 → 2 → 3 → 4)

1. **`database.json` location becomes configurable** — a prerequisite; it's hardcoded in `build.js` *and*
   the admin server today. One config key, read by both.
2. **`ssg add admin`** — a new **kind** that adopts (copies) the admin into the site at a configurable
   folder, so the site **owns + customizes** it.
3. **Data-model-driven CRUD** — the admin walks every collection's `data_model` and generates edit UI
   **per part** (`object` → a schema-driven form, `paths` → an image/file manager, `file_path` → one file).
4. **Admin config + security** — a config block: **localhost-only by default** (user can disable),
   pluggable auth later.

---

## Current state (what we're changing)

- **The admin lives in the engine:** `engine/shared/admin/` — `server.js` (Express + Multer, ~340 lines),
  `public/` (`index.html` + `app.js`), and its own `package.json` (`express`, `multer`). `ssg admin` runs
  it via `require('./shared/admin/server.js')`.
- **It is *half* data-driven:** it reads `database.json` for the **collection list** + each collection's
  `source`/`enabled`, but **hardcodes the item shape** — an item is a folder with `product.json` + image
  files (fixed extensions), at `/api/products/:collection`. It ignores `data_model`.
- **`database.json` is hardcoded twice:** `build.js` (`DATABASE_FILE = SITE_ROOT/shared/database.json`)
  and `admin/server.js` (`DATABASE_PATH = ROOT_DIR/shared/database.json`). Collection `source` paths are
  **site-root-relative** (`"shared/products"`) and stay that way (Decided).

---

## Part 1 — configurable `database.json` (prerequisite)

Add a **`dirs.database`** key (a *file* path, default `"shared/database.json"`); `build.js` and the admin
both resolve it via `lib/dirs.js`. Collection `source` paths remain **site-root-relative** — `database.json`
already carries all the "what to fetch and from where," so nothing else moves.

```json
"dirs": { …, "database": "shared/database.json" }
```

- `lib/dirs.js`: add `database` to the resolver (it's a file, not a folder — the one non-folder entry;
  keep it in `dirs` since it *is* a path the workspace declares).
- `build.js` `DATABASE_FILE` and the admin's `DATABASE_PATH` both read `siteDirs(siteRoot).database` — the
  two hardcoded readers converge on one config.

---

## Part 2 — `ssg add admin`

A new **`admin` kind** in the `ssg add` dispatcher (`page`/`component`/`generator`/`builder`/`test`/
`material`/**`admin`**). It's *adopt-existing* — copy the whole `admin/` tree into the site — a
**singleton** (no `<name>`), and **whole-folder** (an existing admin is overwritten on confirm, not
per-file gap-filled like `material`; see Re-run).

- **Placement + precedence:** `--folder <dir>` › existing `dirs.admin` › **default `shared/admin/`**.
- **`dirs.admin` recorded + a minimal config seeded (Decided).** `ssg add admin` writes `dirs.admin` into
  `config.json` (the default `"shared/admin"`, or the `--folder` value — so `--folder` both places the
  copy *and* sets `dirs.admin`) and seeds a minimal **`admin` block** (`localhost_only: true`, `port`). It
  does **not** drop an `admin.json` — that's left for when the user isolates the admin (Part 4).
- **Re-run / update (Decided).** Whole-folder: targeting a folder that **already has an admin** → warn
  *"admin already exists"* + prompt **overwrite `(y/n)`** (`--force` skips the prompt). Targeting a **new
  folder** → copy a fresh admin there and **repoint `dirs.admin`** to it (the previous folder stays on
  disk), so you can keep backups or test alternate admins and switch the active one via `dirs.admin`.
  Non-TTY defaults to **no** (don't overwrite); `--yes` / `--no` / `--force` set it explicitly.
- **Source (Decided):** post-slim-core the admin lives in the engine **`catalog/admin/`** as a
  **permanent, non-removable** fixture (flagged so future catalog trimming never drops it); `ssg add
  admin` copies from there. (Interim: relocate `engine/shared/admin/` → `catalog/admin/`.)
- **Auto-install deps (Decided).** After copying, `ssg add admin` runs `npm install` in the admin folder
  (Express + Multer). The zero-dependency promise covers the **build only**, not the admin. (`--no-install`
  to skip.)
- **`ssg admin` resolution (Decided).** Read `dirs.admin`; run that folder's server if present. If
  `dirs.admin` is set but the folder is **missing**, print a warning and **prompt** `launch the default
  (engine) admin? (y/n)`. **Non-TTY defaults to `no`** (don't launch → exit with the not-found error);
  `--yes` / `--no` / `--no-input` set the answer explicitly.

---

## Part 3 — data-model-driven CRUD

The admin reads `database.json` → each enabled collection → walks its `data_model` parts and generates UI
**per part type**:

- **`type: "object"`** (e.g. `product.json`) → a **form** built from a **field schema on the part**
  (Decided: the schema lives *in* `database.json`, on the `data_model` part). Recommended shape: keep
  `type: "object"` as the discriminator and add an optional **`schema`** key:

  ```json
  "data": {
    "match": "product.json", "type": "object", "copy": false, "required": true,
    "schema": {
      "name":        { "type": "string",  "label": "Name", "required": true },
      "price":       { "type": "number",  "label": "Price ($)" },
      "description": { "type": "text",     "label": "Description" }
    }
  }
  ```

  No `schema` → fall back to a raw-JSON editor. *(The alternative the user floated — replacing
  `"type": "object"` with `"type": { …schema }` — overloads `type` and loses the string discriminator
  shared with `paths`/`file_path`; the separate `schema` key is additive + backward-compatible.)*

  **Field types (v1, expandable — Decided):** `string`, `text` (multiline), `number`, `boolean`,
  `select` (+ `options`), `datetime`; per-field attributes `label`, `required`, `default`, and
  `validation` (e.g. min/max/pattern). The admin resolves each `type` through a **field-type registry —
  `admin/fieldTypes.js` in the owned copy** (type name → `{ input, parse, serialize, validate }`), so
  **adding a type is editing one file** — future types (`richtext`, `color`, an image/item reference, …)
  drop in without touching the core. A schema field may also carry **`hide: true`** — declared in the
  model but not shown in the form (the field-level counterpart of the part/collection `hide` in Part 4).
- **`type: "paths"`** (e.g. images) → an **file manager** for that glob: upload (Multer), list, reorder,
  delete. The `match` glob bounds the type; extra upload limits (count/size/accept/ordering) come from the
  **admin config** (Part 4), not `data_model`.
- **`type: "file_path"`** → a **single-file** slot (same admin-config limits apply).
- Item identity = the item folder name (`{slug}` = `ctx.collection.items` `id`).

**Reuse the engine's reader.** Surface items via the *same* `data_model` resolution the build uses
(`resolveCollectionItems` → `[{ id, item }]`) so admin + build agree; factor it into `lib/` and share it.
The admin **writes to source** (`shared/products/<item>/product.json` + files); the build reads source.

---

## Part 4 — admin config + security

The admin loads its config from **`<dirs.admin>/admin.json` if present, else the `config.json` `admin`
block** (Decided). Default is the `config.json` block (consistent with `log`/`test`/`dirs`; the CLI
already reads `config.json`); dropping an `admin.json` into the admin folder overrides it — the seam for
lifting the admin into an **isolated project** later, and it lets backup/test admin folders carry their
own settings.

```json
"admin": {
  "localhost_only": true,            // DEFAULT ON — bind to 127.0.0.1; disable to expose
  "port": 3000,
  "collections": {
    "products": {
      "images": { "max_count": 8, "max_size_mb": 5, "accept": ["jpg", "png", "webp"], "orderable": true }
      // "<part>": { "hide": true }   // hide a part (fields hide via their schema entry; collections via database.json `enabled`)
    }
  }
  // "auth": … (future: pick a built-in method; for now, write it in the owned server.js)
}
```

- **Localhost-only is the default.** The server binds to `127.0.0.1`; the user must explicitly set
  `localhost_only: false` to expose it.
- **Per-collection / per-part config (Decided).** `admin.collections` is **purely additive** —
  **everything shows by default** (all enabled collections, all their `data_model` parts); omitting a
  collection or part does *not* hide it. Keyed `collections.<name>.<part>`, joined to `data_model` by part
  name; a part key that matches **no `data_model` part → error** (typo/rename). Each entry holds that
  thing's admin config: an explicit **`hide: true`** to hide a **part** (whole collections use
  **`enabled`** in `database.json` — the single build+admin switch; no separate admin collection-hide),
  and for `paths`/`file_path` the **upload limits** (max count/size, accepted types beyond the `match`
  glob, ordering) — kept here, not in `data_model` (a build concern). Field-level hiding is a
  `hide: true` on the field's `schema` entry (Part 3).
- **Auth (Decided):** for now, users write their own auth in the owned `server.js`; later, a
  config-selectable method. Never expose without auth.

---

## Notes & suggestions

- **The admin *is* the data model rendered.** One source of truth: the `data_model` that whitelists
  `build/` and feeds generators becomes the admin's schema (parts) + form fields (`schema`).
- **Singleton, owned, permanent.** `ssg add admin` (no name); `catalog/admin` marked non-removable; the
  site owns its copy and can extend routes/fields/auth without forking the engine.
- **Two extension seams.** The **field-type registry** (add input types) and **`admin.json`** (lift into
  an isolated project; per-folder configs for backup/test admins) both extend the admin without forking —
  the owned copy is meant to grow.
- **`dirs.database` also DRYs the build.** Even ignoring the admin, having `build.js` stop hardcoding
  `shared/database.json` is a clean win and reuses the existing `dirs` machinery.
- **Scope v1 to collections** (see Decided) — config/singleton editing rides with the CMS.

## Caveats / watch-items

- **It edits *source* data — real + gitignored on the private site.** `shared/products`/`custom` hold the
  friend's real data (gitignored). Local editing is fine; the tool must never surface/commit it — the
  private-data boundary holds.
- **Auto `npm install` is a network + side-effect step.** `ssg add admin` shells out to `npm`; needs npm
  + network, and fails offline. `--no-install` + a printed manual step as the fallback.
- **`ssg add admin` writes `config.json`.** Only `--register` does that today (for `component`). Setting
  `dirs.admin` + seeding a minimal `admin` block is a config mutation on adopt — reasonable, but it must
  **merge** (never clobber unrelated keys or an existing `admin` block).
- **Interactive prompts in a CLI.** Both `ssg admin` (missing folder) and `ssg add admin` (overwrite)
  prompt `(y/n)`; a non-TTY run (CI) **defaults to `no`** (`--yes`/`--no`/`--no-input` to control) — so CI
  never hangs or acts destructively.
- **Overwrite replaces a customized admin.** `ssg add admin` on an existing folder overwrites the whole
  tree on `y` (not `material`'s per-file preserve) — a customized `server.js` is lost. Adopt into a **new
  folder** (auto-repoints `dirs.admin`) to keep the old as a backup; such backup/test folders accumulate
  on disk and the user prunes them.
- **Trust boundary.** Adopting the admin = running its `server.js` + installing its deps; a server is a
  bigger surface than a `*.build.js`. Document it.
- **`data_model` `object` part with no `schema`.** Raw-JSON editor until a schema is added — usable, not
  the goal; make the fallback obvious in the UI.

## Decided (final)

- **Field schema lives in `database.json`**, on the `data_model` `object` part — as a separate **`schema`**
  key (recommended) rather than replacing `type`.
- **`database.json` location:** **`dirs.database`** (file path, default `"shared/database.json"`);
  collection `source` paths stay **site-root-relative**.
- **Admin placement:** default **`shared/admin/`**; a **`dirs.admin`** key always set; **`--folder`** places
  the copy *and* sets `dirs.admin`.
- **`ssg add admin` is its own kind** (not `ssg add material admin`).
- **`ssg admin` resolution:** read `dirs.admin`; if the folder is missing, **warn + prompt** to launch the
  default engine admin.
- **Security:** **localhost-only by default** (toggleable); user-written auth now, config-selectable later;
  a JSON admin config exists for these.
- **Post-slim-core source:** admin → **`catalog/admin/`**, **non-removable**.
- **Deps:** **auto-install**; the zero-dep promise is build-only.
- **Scope:** **collections in v1**; config/singleton editing deferred (see Q5).
- **Multi-file/relational:** future `data_model`/`database.json` enhancement, not v1.
- **Field types (v1):** `string`/`text`/`number`/`boolean`/`select`(+`options`)/`datetime` + `label`/
  `required`/`default`/`validation`, resolved via an **expandable field-type registry** (add a type =
  register one entry).
- **Admin config home:** the `config.json` `admin` block, but the admin loads **`<dirs.admin>/admin.json`
  first if present** (the isolated-project seam; per-folder configs also serve backup/test admins).
- **`paths`/`file_path` upload limits** (count/size/accept/ordering) live in the **admin config**
  (`collections.<name>.<part>`), not `data_model`.
- **`ssg add admin` re-run:** whole-folder — existing folder → prompt **overwrite**; new folder → copy +
  **repoint `dirs.admin`** (previous stays as a backup / test admin).
- **Config singletons:** **deferred to the CMS** (confirmed).
- **Admin config seeding:** `ssg add admin` sets `dirs.admin` + seeds a **minimal `admin` block**
  (`localhost_only`/`port`); no `admin.json` (left for isolation).
- **Field-type registry:** custom types by **editing `admin/fieldTypes.js`** in the owned copy.
- **Non-interactive prompts:** both `(y/n)` prompts default to **no** without a TTY; `--yes` / `--no` /
  `--no-input` (and `--force` for overwrite) set the answer.
- **`admin.collections` is additive; show-all by default:** everything shows unless **explicitly hidden**
  via `hide: true` (on a field's `schema` entry, or a part); omitting from `admin.collections` never
  hides. A config part with **no matching `data_model` part → error**.
- **Collection show/hide = `database.json` `enabled`** (existing switch — drops the collection from
  *both* the build and the admin); no separate admin-level collection hide.

## Implementation plan (phases & commits)

No open questions. `npm test` green after each commit; every commit ships a smoke check. **Phase 1 is
independently shippable** (a clean build-side win); **Phase 3 is the bulk**. Admin deps (`express`,
`multer`) are opt-in — the engine's *build* stays zero-dependency.

### ✅ Phase 1 — `dirs.database` *(foundation; additive)* — `df22abf` (on `main`)
- **P1.** `lib/dirs.js`: add `database` (default `"shared/database.json"`) to `DEFAULT_DIRS`; `build.js`
  reads `siteDirs(SITE_ROOT).database` for `DATABASE_FILE`. Smoke: a site with `dirs.database` at a custom
  path builds. *(No site change; sites can set it whenever.)*

### ✅ Phase 2 — adopt the admin (`ssg add admin`) — `e7999aa` (P2.1), `c290ef9` (P2.2)
- **P2.1 — relocate + resolve.** `git mv engine/shared/admin/` → **`catalog/admin/`** (flag it
  non-removable via a `catalog/admin/README`); `cli.js` `ssg admin` resolves **site-first via `dirs.admin`**,
  else `catalog/admin`, and on a **missing** `dirs.admin` folder warns + prompts `(y/n)` (non-TTY → **no**)
  to launch the default; the admin's `DATABASE_PATH` reads `dirs.database` (the two readers converge).
  Smoke: resolution + the missing-folder path.
- **P2.2 — the `admin` kind.** Add `admin` to the `ssg add` dispatcher: copy `catalog/admin` → target
  (`--folder` › `dirs.admin` › default `shared/admin`), **merge** `dirs.admin` + a minimal `admin` block
  into `config.json`, **auto `npm install`** (`--no-install` to skip), **overwrite-prompt** on an existing
  folder (`--yes`/`--no`/`--force`), **repoint `dirs.admin`** on a new folder. Smoke: adopt into a temp
  site (copy + config merge + dispatch, offline-safe; the install path verified out of band).

### ✅ Phase 3 — data-model-driven CRUD *(the core — split)* — `693308c` (P3.1), `fae3a0d` (P3.2), `2a36e6a` (P3.3)
- **P3.1 — backend + config + security.** Rework `server.js` to be data-model-driven: read `database.json`
  (via `dirs.database`) → `enabled` collections → walk `data_model`; a generic API (list collections /
  items / read+write an item's parts). Per part: `object` read/write, `paths`/`file_path` upload/list/
  delete. Load the admin config (`<dirs.admin>/admin.json` else `config.json.admin`) → `localhost_only`
  (**bind `127.0.0.1` by default**), `port`, per-part upload limits + `hide`. **Validate** `admin.collections`
  part names vs `data_model` (error on mismatch). Reuse the engine's item reader (factor
  `resolveCollectionItems` into `lib/`). Test: drive the API against a fixture site.
- **P3.2 — field-type registry + schema forms.** `admin/fieldTypes.js` (string/text/number/boolean/select/
  datetime → `{ input, parse, serialize, validate }`); `object`-part form built from the part's `schema`
  (fields, types, per-field `hide`); raw-JSON fallback when a part has no `schema`.
- **P3.3 — frontend.** `public/index.html` + `app.js`: render the generated CRUD per part (schema form for
  `object`; file manager for `paths`/`file_path`) honouring `hide` + the upload limits. Manual/e2e check
  against a fixture site.

### ✅ Phase 4 — docs & wrap-up *(this commit)*
- **P4.** README/CLAUDE (`ssg add admin`, `dirs.database`, the `admin` block + localhost default),
  ROADMAP item marked done, this plan marked shipped. (A task-oriented admin guide rides with the
  end-user-docs roadmap task.)

**Then the sites:** `ssg add admin` on the demo (public — exercise it end to end) and the private site
(add `schema`s to its `products`/`custom` `object` parts; adopt the admin; the real data stays gitignored).

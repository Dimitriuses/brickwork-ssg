# Admin panel extension — draft plan (for discussion)

> **Status: draft, refined (round 1 answered).** Expands the **Admin panel extension** item in
> [ROADMAP.md](../ROADMAP.md). The admin becomes a **data-management surface derived from each
> collection's `data_model`**, **owned by the site** (adopted via `ssg add admin`), with `database.json`'s
> location made configurable and its own settings/security config. The **Decided** section locks the
> round-1 answers; **Open questions** are the next round.

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
`material`/**`admin`**). It's *adopt-existing* (copy the whole `admin/` tree, per-file gap-fill +
drift-aware via `lib/deploy.js`), a **singleton** (no `<name>`).

- **Placement + precedence:** `--folder <dir>` › existing `dirs.admin` › **default `shared/admin/`**.
- **`dirs.admin` is always recorded.** `ssg add admin` writes `dirs.admin` into `config.json` — the
  default `"shared/admin"` on a plain run, or the `--folder` value when given (so `--folder` both places
  the copy *and* sets `dirs.admin`). The admin's location is thus always explicit.
- **Source (Decided):** post-slim-core the admin lives in the engine **`catalog/admin/`** as a
  **permanent, non-removable** fixture (flagged so future catalog trimming never drops it); `ssg add
  admin` copies from there. (Interim: relocate `engine/shared/admin/` → `catalog/admin/`.)
- **Auto-install deps (Decided).** After copying, `ssg add admin` runs `npm install` in the admin folder
  (Express + Multer). The zero-dependency promise covers the **build only**, not the admin. (`--no-install`
  to skip.)
- **`ssg admin` resolution (Decided).** Read `dirs.admin`; run that folder's server if present. If
  `dirs.admin` is set but the folder is **missing**, print a warning and **prompt** `launch the default
  (engine) admin? (y/n)`. (Non-interactive behaviour is an open question.)

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
- **`type: "paths"`** (e.g. images) → an **file manager** for that glob: upload (Multer), list, reorder,
  delete — the extension set comes from the part's `match`.
- **`type: "file_path"`** → a **single-file** slot.
- Item identity = the item folder name (`{slug}` = `ctx.collection.items` `id`).

**Reuse the engine's reader.** Surface items via the *same* `data_model` resolution the build uses
(`resolveCollectionItems` → `[{ id, item }]`) so admin + build agree; factor it into `lib/` and share it.
The admin **writes to source** (`shared/products/<item>/product.json` + files); the build reads source.

---

## Part 4 — admin config + security

A **`config.json` `admin` block** (consistent with the `log`/`test`/`dirs` blocks; the CLI already reads
`config.json`) — the "*.json config with admin settings" the user asked for:

```json
"admin": {
  "localhost_only": true,      // DEFAULT ON — bind to 127.0.0.1; disable to expose
  "port": 3000
  // "auth": … (future: pick a built-in method; for now, edit the owned server.js yourself)
}
```

- **Localhost-only is the default.** The server binds to `127.0.0.1`; the user must explicitly set
  `localhost_only: false` to expose it.
- **Auth (Decided):** for now, users write their own auth in the owned `server.js`; later, a
  config-selectable method. Never expose without auth.

---

## Notes & suggestions

- **The admin *is* the data model rendered.** One source of truth: the `data_model` that whitelists
  `build/` and feeds generators becomes the admin's schema (parts) + form fields (`schema`).
- **Singleton, owned, permanent.** `ssg add admin` (no name); `catalog/admin` marked non-removable; the
  site owns its copy and can extend routes/fields/auth without forking the engine.
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
  `dirs.admin` (and maybe seeding the `admin` block) is a config mutation on adopt — reasonable, but note
  it (and never clobber unrelated keys).
- **Interactive prompt in a CLI.** The `ssg admin` `(y/n)` needs a non-TTY answer (CI) — see open Qs.
- **Trust boundary.** Adopting the admin = running its `server.js` + installing its deps; a server is a
  bigger surface than a `*.build.js`. Document it.
- **`data_model` `object` part with no `schema`.** Raw-JSON editor until a schema is added — usable, not
  the goal; make the fallback obvious in the UI.

## Decided (round 1)

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

## Open questions (round 2)

1. **Field-schema vocabulary.** What `type`s does a `schema` field support — `string`, `text`
   (multiline), `number`, `boolean`, `select` (+`options`), `date`, …? And per-field attributes: `label`,
   `required`, `default`, `placeholder`, validation (min/max/pattern)? A small, fixed set to start, or
   open/extensible? This is the next design level under the Decided `schema` key.
2. **Admin config home.** A `config.json` **`admin` block** (recommended — consistent, CLI already reads
   `config.json`) vs a dedicated **`<dirs.admin>/admin.json`** shipped with the owned admin? ("a *.json
   config file" could mean either.)
3. **`ssg admin` non-interactive behaviour.** When the `dirs.admin` folder is missing and there's no TTY
   (CI, piped): default to the engine admin, error, or require a flag (`--default` / `--no`)?
4. **`paths`/`file_path` part options.** Do image/file parts need their own admin settings (max count, max
   size, accepted types beyond the `match` glob, ordering)? On the part, or admin-config-wide?
5. **Config singletons & "move them to `database.json`?"** *(my read + a question)* — I'd **keep
   `config.json` for engine/build settings** (`dirs`/`log`/`test`) — those aren't content — and treat the
   *content* singletons (`nav`, `social`, `contact`, theme) as a **CMS** concern, not v1 admin. Whether
   those singletons then live in `config.json` (with a schema) or move into `database.json` as
   schema'd "singleton collections" is exactly the CMS's core modelling decision — I'd **settle it there**,
   not here, so the admin extension stays scoped to `data_model` collections. Agree to defer, or decide the
   home now?
6. **`ssg add admin` re-run / update.** On a second `ssg add admin`, is it gap-fill + drift-report like
   `material` (so a customized `server.js` is preserved, `--force` to overwrite)? Assumed yes — confirm.

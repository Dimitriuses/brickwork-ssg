# Admin panel extension — draft plan (for discussion)

> **Status: draft.** Expands the **Admin panel extension** item in [ROADMAP.md](../ROADMAP.md) into a
> per-item design. The admin should become a **data-management surface derived from the same data the
> build uses** — driven by each collection's `data_model` — **owned by the site** (adopted via
> `ssg add admin`), with `database.json`'s location made configurable (it's hardcoded in *two* places
> today). A starting point to argue with, not a spec.

## The three pieces

1. **`database.json` location becomes configurable** — a prerequisite. Today it's hardcoded at
   `SITE_ROOT/shared/database.json` in **both** `build.js` and the admin server; one config, read by both.
2. **`ssg add admin`** — adopt the admin into the site (copy from the engine) at a configurable folder
   (`--folder` › `dirs.admin` › `<data-root>/admin/` default), so the site **owns + customizes** it.
3. **Data-model-driven CRUD** — the admin reads `database.json`, walks every collection's `data_model`,
   and generates edit UI **per part** (`object` → a form, `paths` → an image/file manager,
   `file_path` → a single file) instead of hardcoding the products/images shape.

Recommended order: **1 → 2 → 3.** (1) is small and unblocks both the build and the admin reading one
configured path; (2) is the ownership/plumbing; (3) is the real feature and the largest surface.

---

## Current state (what we're changing)

- **The admin lives in the engine:** `engine/shared/admin/` — `server.js` (Express + Multer, ~340 lines),
  `public/` (`index.html` + `app.js` frontend), and its own `package.json` (`express`, `multer`).
  `ssg admin` runs it via `require('./shared/admin/server.js')` (engine-relative).
- **It is *half* data-driven:** it reads `database.json` for the **collection list** + each collection's
  `source`/`enabled`, but **hardcodes the item shape** — an item is a folder with `product.json` + image
  files (fixed extensions), exposed at `/api/products/:collection`. It does **not** consult `data_model`.
- **`database.json` is hardcoded twice:** `build.js` (`DATABASE_FILE = SITE_ROOT/shared/database.json`)
  and `admin/server.js` (`DATABASE_PATH = ROOT_DIR/shared/database.json`). Collection `source` paths are
  **site-root-relative** (e.g. `"shared/products"`).
- **`data_model` today** (per collection, in `database.json`): an object keyed by *part* name, each
  `{ match, type, copy, required }` — `type` ∈ `object` (parse a JSON file), `paths` (files → web-path
  array), `file_path` (one file). It says *what the parts are and whether they ship to `build/`* — but
  **not the fields inside an `object` part** (that's the crux for a generated form; see open questions).

---

## Part 1 — configurable `database.json` (prerequisite)

**Goal.** Stop hardcoding `shared/database.json`; declare it once; have `build.js` and the admin read the
same place. Fits the existing `dirs` layout work.

**Proposal.** Add a **data root** to `dirs` (default `"shared"`), and resolve `database.json` inside it:

```json
"dirs": { …, "data": "shared" }        // database.json = <data>/database.json
```

- `build.js` and the admin both call `lib/dirs.js` → `siteDirs(siteRoot).data` → `.../database.json`.
- `lib/dirs.js` already resolves everything else; this is one more key + two call-site swaps.

**Sharpen:**
- **Do collection `source` paths stay site-root-relative** (`"shared/products"`, explicit, unchanged) —
  or become **data-root-relative** (`"products"`, so the whole data tree moves with `dirs.data`)? The
  first is zero-migration but leaves `source` un-scoped by `dirs.data`; the second is consistent but a
  breaking `database.json` edit on both sites. *(Open question — leaning data-root-relative long-term,
  site-root-relative now.)*
- Alternative shape: a direct file key (`"dirs": { "database": "shared/database.json" }`) instead of a
  data-root folder. A folder fits `dirs` better and also scopes `source`; a file key is more explicit.

---

## Part 2 — `ssg add admin`

**Goal.** Let a site **own** the admin (adopt + customize it), the way `ssg add material` vends a
component — but the admin is a **singleton**, not a named material, so it's its own kind.

**Shape.** `ssg add admin [--folder <dir>] [--force] [--dry-run]` — copy the engine's `shared/admin/`
(`server.js`, `public/`, `package.json`) into the site at:

  **`--folder <dir>` › `dirs.admin` (if set) › `<data-root>/admin/` (default, e.g. `shared/admin/`).**

- **Kind, not scaffold.** It's *adopt-existing* (copy, like `material`), not *author-new* — reuse
  `lib/deploy.js`'s per-file gap-fill + drift detection. Add `admin` to the `ssg add` kind dispatcher
  (`page`/`component`/`generator`/`builder`/`test`/`material`/**`admin`**). Unlike `material`, it takes
  no `<name>` (singleton) and copies a whole tree, not a component folder.
- **`ssg admin` resolves site-first.** After adoption, `ssg admin` runs the **site's** copy (at the
  resolved folder) if present, else the engine's — same site-first spirit as component resolution. cli.js
  learns the admin folder from `dirs.admin`/default.
- **Deps.** The copied admin has its own `package.json` (`express`, `multer`); the user runs
  `npm install` in the admin folder (or `ssg add admin` prints the next step). Same trade-off as today's
  `npm --prefix engine install`, just relocated.

---

## Part 3 — data-model-driven CRUD

**Goal.** Replace the hardcoded `product.json` + image assumptions with UI generated from each
collection's `data_model`, so the admin manages *any* collection the build knows about.

**Mechanism.** The admin reads `database.json` → for each enabled collection, walk `data_model` parts:
- **`type: "object"`** (e.g. `product.json`) → an **edit form** for the object's fields. *Needs a field
  schema the model doesn't carry yet* — see open questions.
- **`type: "paths"`** (e.g. images) → an **file manager** for that glob: upload (Multer), list, reorder,
  delete. Generalises today's product-image handling to any `paths` part.
- **`type: "file_path"`** → a **single-file** slot.
- Item identity = the item folder name (the `{slug}`), matching `ctx.collection.items` `id`.

**Reuse the engine's resolution.** The admin should surface items via the **same `data_model` read the
build uses** (`resolveCollectionItems` / `ctx.collection.items = [{ id, item }]`) so admin + build agree
on the data. Factor that reader into `lib/` if it isn't already importable, and share it.

**Write path.** The admin **writes to the source** (`<data-root>/products/<item>/product.json` + image
files); the build **reads the source** per `data_model` and regenerates. So the admin edits source, a
rebuild reflects it. (No writes to `build/`.)

---

## Notes & suggestions

- **The admin is derived from the data model — lean into it.** The same `data_model` that whitelists
  `build/` and feeds generators becomes the admin's schema. One source of truth for "what an item is."
- **Keep it a singleton.** `ssg add admin` (no name), one per site — don't force it through the
  `<kind> <name>` author-new shape (that's why it was deferred from the first `ssg add` cut).
- **Own-and-customise is the point.** Once copied, the site can add routes/fields/auth without forking
  the engine — same ownership model as adopted components.
- **Slim-core alignment.** If/when the admin moves into the `catalog/` (Phase 2 left this open), `ssg add
  admin` sources from there instead of `engine/shared/admin/`; the command stays the same.
- **Config editing later.** A natural follow-on: edit `config.json` (nav, social, theme) from the admin
  too — but scope v1 to collections.

## Caveats / watch-items

- **`object` parts have no field schema.** `type: "object"` parses the JSON but doesn't declare its
  fields, so the admin can't render a typed form without more info. This is the **central design
  decision** (open questions). Until resolved, the admin can only offer a raw-JSON editor for `object`
  parts — usable but not the goal.
- **Auth / exposure.** The current server is an unauthenticated localhost dev tool (`PORT = 3000`, no
  login). Owning it invites deploying it; **do not** without an auth story. v1 stays localhost-only,
  documented as such.
- **It edits *source* data — which is gitignored + real on the private site.** `shared/products` /
  `shared/custom` hold the friend's real data (gitignored). The admin writing there is fine locally, but
  the tool must never surface/commit it; keep the private-data boundary.
- **Trust boundary.** Adopting the admin = running its `server.js` (arbitrary JS) + installing its deps.
  Same as any adopted `*.build.js`, but a server is a bigger surface — note it.
- **Multer / uploads.** Generalising image upload to any `paths` part means validating extensions per the
  part's `match` glob, path-traversal safety (the server already does `resolveWithin`-style checks), and
  size limits.
- **Two `database.json` readers must converge.** After Part 1, delete the admin's separate hardcoded
  `DATABASE_PATH` and read the configured path — or they drift.

## Open questions

1. **`object`-part field schema (the big one).** How does the admin know a `type: "object"` part's
   fields to render a form? Options: **(a)** extend the model — an optional `fields` map on the part
   (`"fields": { "name": { "type": "string", "label": "Name" }, "price": { "type": "number" }, … }`),
   the natural home since the model already describes the data; **(b)** **infer** fields from an existing
   item's JSON (zero-config, but no types/labels/validation and nothing to show for a brand-new item);
   **(c)** a **separate** admin schema (decoupled but duplicated). Leaning (a) with (b) as a fallback.
2. **`database.json` location shape.** `dirs.data` (data-root folder) vs a direct `dirs.database` file
   key? And do collection `source` paths stay site-root-relative or become data-root-relative?
3. **Admin placement + precedence.** Confirm `--folder` › `dirs.admin` › `<data-root>/admin/` default,
   and whether `dirs.admin` is worth a dedicated `dirs` key vs just `--folder` + default.
4. **`ssg add admin` as a kind.** A new `admin` kind in the dispatcher (chosen here) vs `ssg add material
   admin` (roadmap's earlier guess). The singleton/whole-tree nature argues for its own kind.
5. **`ssg admin` resolution.** Exactly how cli.js finds the (possibly relocated) admin folder — from
   `dirs.admin`/default, site-first then engine fallback.
6. **Auth.** None today. Add basic auth / a token, or hard-restrict to localhost? Needed before anyone
   deploys it.
7. **Where does the adopted admin come from post-slim-core?** `engine/shared/admin/` now; `catalog/`
   later? Affects the deploy source.
8. **Dependency install.** Automate `npm install` in the admin folder after `ssg add admin`, or just
   print the step? (Keep the zero-dep *build* promise — the admin's deps are opt-in.)
9. **Scope of editability.** Collections only (v1), or also `config.json` / non-collection singletons
   (nav, social, theme, pages)? The latter needs a schema for non-`data_model` data.
10. **Multi-file / relational data.** Items with more than `object` + `images` (e.g. variants, linked
    collections) — does the `data_model` express that, or is it out of scope for v1?

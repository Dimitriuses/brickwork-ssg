# Default admin panel (bundled)

The engine's built-in admin server (Express + Multer). It lives in `catalog/` so `ssg admin` can
launch it as a fallback and `ssg add admin` can copy it into a site as the site's own, editable copy.

**Not a component material — do not prune it.** Unlike the component folders alongside it in
`catalog/`, `admin/` is a small Node app, not a build material: it is never deployed by
`ssg add material` / `--all-used`, and the slim-core tooling must leave it in place. Adopt it into a
site with `ssg add admin` (see `docs/admin-extension-plan.md`).

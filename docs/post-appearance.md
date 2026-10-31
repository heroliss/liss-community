# Optional article appearance

Articles may save a local color accent and a material without changing their
Markdown, rendered content, author, project association, visibility, or URL.
`PostAppearance` is an optional one-to-one row keyed by `posts.id`. Existing
articles have no row and keep the site's deterministic default presentation.

## Form and rendering contract

- `appearance_color`: empty for the automatic color, or an exact `#RRGGBB` token;
  stored in lowercase. Whitespace, short hex, named colors, and CSS are rejected.
- `appearance_material`: `auto`, `glass`, `frosted`, `ceramic`, `paper`, `metal`,
  `leather`, `cork`, `slate`, `mirror`, or `water`. The ten concrete materials
  plus `auto` are eleven choices. `glass` and `frosted` persist separately while
  sharing the physical glass renderer with distinct optical settings. `mirror`
  and `water` are explicit opt-in materials; automatic selection keeps the
  existing material mapping.
- Both fields explicitly set to empty color and `auto` remove the optional row.
- Older clients omitting both fields keep a saved appearance when editing.
  When only one field is supplied, the omitted field keeps its saved value.
- Native creation, edit, and project-discussion routes save the appearance in
  their existing content transaction. Their original permission, guest quota,
  and CSRF checks remain in place. The existing REST API remains body-focused
  and does not interpret appearance payloads.

The shared Jinja function `post_appearance(post)` returns `color`, `material`,
`hue`, `saturation`, and `custom`. RGB is converted to HSL; hue is
`floor(h * 360 + .5) % 360`. Saturation is zero below `.08`, otherwise
`floor(max(18, min(55, s * 100)) + .5)`. Selected lightness is discarded.
The frontend should use these bounded numbers for local edge, light, and tint
accents while retaining the shared text/surface contrast. The HEX value is
validated and suitable for pre-filling the editor, not a raw CSS declaration.
Malformed legacy/raw values fall back to automatic tokens on rendering.

## Mirror and water rendering

The two v40 surfaces add simulated environment reflections below the reading
plane. The mirror combines a reflective edge, restrained scratches, and a
pointer-responsive scene image. Water combines translucent backdrop filtering,
sky-colored reflections, a few floating specks, and pointer-generated ripples.
Article text and controls are not duplicated into the reflection.

Selected same-origin background artwork is reused through the browser's image
resource/cache. Procedural backgrounds supply their scene colors; a sky gradient
remains available without an image. The effect does not capture the page or
perform physical ray tracing, and it does not require an additional external
image service. Other materials retain their existing optical treatment.

The controller schedules animation frames only while pointer offsets settle.
Each water surface keeps at most four ripples, with movement thresholds and
rate limiting; animation completion or a timeout removes each ripple. Offscreen
surfaces, hidden pages, coarse pointers, reduced motion, and forced colors stop
or reset interactive motion. Removed or changed surfaces release listeners and
decorative nodes; page exit suspends work and returning restores the controller.
These bounds describe the implementation, not a measured GPU cost or FPS result.

## Additive schema rollout

The new Alembic revision `20261030_post_appearance` follows
`20261024_owner_identity`. It creates only `post_appearances`, with a unique
primary/foreign key, `ON DELETE CASCADE`, a material allowlist constraint, and a
basic color-shape constraint. Full HEX validation also runs in the form, ORM,
and renderer. It is idempotent if public-demo initialization already created
the table. The downgrade deliberately refuses to discard saved appearance
data; restoring a verified backup is the supported rollback.

For the persistent public-demo mode, the existing `Sandbox.prepare()` calls
`db.create_all()` before reading/seeding article data. After the operator takes
a consistent backup of the intended local store, restarting the application
with the same storage and identity configuration adds the missing table. No
article columns, saved bodies, or identity epoch are rewritten by this feature.
Normal deployments should apply the Alembic revision before workers run the
new model. This change does not itself deploy or access production storage.

The migration chain continues through `20261031_material_catalog`,
`20261031_glass_finishes`, `20261031_discussion_replies`, and
`20261031_reflective_materials`. The material revisions extend the allowlist
from five choices to eight, nine, and finally eleven; these totals include
`auto`. The v40 reflective revision follows the discussion revision in the
single Alembic chain and accepts the recognized nine-choice predecessor. An
already upgraded eleven-choice schema is retained without narrowing it.

Persistent public-demo preparation can upgrade a recognized five-, eight-, or
nine-choice material constraint directly to the current eleven choices. It
takes a consistent SQLite backup before rebuilding the constraint, preserves
existing rows and the owning `ON DELETE CASCADE` relationship, and rolls back
the table rebuild if copying fails. An unknown constraint stops preparation for
inspection. Normal Alembic deployments apply the complete chain, not only the
first appearance revision; they require the operator's consistent backup.

Downgrading the reflective revision refuses to narrow the allowlist while any
article still saves `mirror` or `water`. Choose another material for those
articles deliberately, or restore a verified backup using the normal recovery
procedure; the migration never silently converts or deletes those choices.
See [v29](community-v29.md#数据升级与验证),
[v31](community-v31.md#数据兼容), and [v40](community-v40.md#存储升级与保护).
Rehearse against a consistent private copy before changing the live store.

## Isolated verification

Run from this repository with its virtual environment:

```powershell
.venv/Scripts/python.exe -B -m unittest tests.test_post_appearance -v
.venv/Scripts/python.exe -B -m unittest tests.test_reflective_materials -v
```

The tests use fresh temporary public-demo stores and in-memory SQLite engines.
They cover creation, editing, reset, omitted and partial fields, strict input
validation, preserved Markdown, native permissions and CSRF, project links,
restarts, old-store schema preparation, additive migration behavior, and
backward-compatible API updates. Reflective-material tests additionally cover
recognized older catalogs, idempotent preparation, usable backups, rollback on
copy failure, preserved indexes and cascade, unknown constraints, and guarded
downgrades. `scripts/tests/reflections.test.cjs` exercises the actual browser
controller's bounded ripples, preferences, background changes, and lifecycle.
The isolated checks do not open or alter the repository demo database or a
shared browser preview fixture. They do not establish visual realism, physical
reflection accuracy, cross-browser rendering, or measured FPS.

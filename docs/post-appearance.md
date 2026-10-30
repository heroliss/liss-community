# Optional article appearance

Articles may save a local color accent and a material without changing their
Markdown, rendered content, author, project association, visibility, or URL.
`PostAppearance` is an optional one-to-one row keyed by `posts.id`. Existing
articles have no row and keep the site's deterministic default presentation.

## Form and rendering contract

- `appearance_color`: empty for the automatic color, or an exact `#RRGGBB` token;
  stored in lowercase. Whitespace, short hex, named colors, and CSS are rejected.
- `appearance_material`: `auto`, `glass`, `ceramic`, `paper`, or `metal`.
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

## Isolated verification

Run from this repository with its virtual environment:

```powershell
.venv/Scripts/python.exe -B -m unittest tests.test_post_appearance -v
```

The tests use fresh temporary public-demo stores and in-memory SQLite engines.
They cover creation, editing, reset, omitted and partial fields, strict input
validation, preserved Markdown, native permissions and CSRF, project links,
restarts, old-store schema preparation, additive migration behavior, and
backward-compatible API updates. They do not open or alter the repository demo
database or a shared browser preview fixture.

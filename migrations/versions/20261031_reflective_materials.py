"""Allow mirror and water without rewriting saved article presentation."""
import re

from alembic import op
import sqlalchemy as sa


revision = '20261031_reflective_materials'
down_revision = '20261031_discussion_replies'
branch_labels = None
depends_on = None

_PREVIOUS = ('auto', 'glass', 'ceramic', 'paper', 'metal', 'leather', 'cork', 'slate', 'frosted')
_CURRENT = _PREVIOUS + ('mirror', 'water')


def _tokens():
    constraints = sa.inspect(op.get_bind()).get_check_constraints('post_appearances')
    current = next((item['sqltext'] for item in constraints
                    if item['name'] == 'ck_post_appearance_material'), None)
    known_shape = re.fullmatch(r"\s*card_material\s+IN\s*\(\s*'[a-z]+'(?:\s*,\s*'[a-z]+')*\s*\)\s*", current or '', re.I)
    return set(re.findall(r"'([^']*)'", current or '')) if known_shape else set()


def _replace_constraint(tokens):
    table = sa.Table('post_appearances', sa.MetaData(), autoload_with=op.get_bind())
    # Legacy SQLite reflection can omit CASCADE on this owning relationship.
    for foreign_key in table.foreign_key_constraints:
        if ([column.name for column in foreign_key.columns] == ['post_id']
                and [element.target_fullname for element in foreign_key.elements] == ['posts.id']):
            foreign_key.ondelete = 'CASCADE'
    check = 'card_material IN (' + ','.join("'" + token + "'" for token in tokens) + ')'
    with op.batch_alter_table('post_appearances', copy_from=table) as batch:
        batch.drop_constraint('ck_post_appearance_material', type_='check')
        batch.create_check_constraint('ck_post_appearance_material', check)


def upgrade():
    tokens = _tokens()
    if tokens == set(_CURRENT):
        return  # The backed-up public preparation path may already have run.
    if tokens != set(_PREVIOUS):
        raise RuntimeError('Unrecognized post material constraint; keep the database and inspect its schema before upgrading.')
    _replace_constraint(_CURRENT)


def downgrade():
    tokens = _tokens()
    if tokens == set(_PREVIOUS):
        return
    if tokens != set(_CURRENT):
        raise RuntimeError('Unrecognized post material constraint; keep the database and inspect its schema before downgrading.')
    saved = op.get_bind().execute(sa.text(
        "SELECT COUNT(*) FROM post_appearances WHERE card_material IN ('mirror','water')")).scalar_one()
    if saved:
        raise RuntimeError('Saved mirror or water choices are user data; choose another material for those articles or restore a verified backup before downgrading.')
    _replace_constraint(_PREVIOUS)

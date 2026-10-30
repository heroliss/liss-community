"""Extend the material check without changing saved article presentation."""
import re

from alembic import op
import sqlalchemy as sa


revision = '20261031_material_catalog'
down_revision = '20261030_post_appearance'
branch_labels = None
depends_on = None

_OLD = {'auto', 'glass', 'ceramic', 'paper', 'metal'}
_NEW = _OLD | {'leather', 'cork', 'slate'}
_CHECK = "card_material IN ('auto','glass','ceramic','paper','metal','leather','cork','slate')"


def upgrade():
    constraints = sa.inspect(op.get_bind()).get_check_constraints('post_appearances')
    current = next((item['sqltext'] for item in constraints
                    if item['name'] == 'ck_post_appearance_material'), None)
    known_shape = re.fullmatch(r"\s*card_material\s+IN\s*\(\s*'[a-z]+'(?:\s*,\s*'[a-z]+')*\s*\)\s*", current or '', re.I)
    tokens = set(re.findall(r"'([^']*)'", current or '')) if known_shape else set()
    # Public-demo preparation may already have installed the current check.
    if tokens == _NEW:
        return
    if tokens != _OLD:
        raise RuntimeError('Unrecognized post material constraint; keep the database and inspect its schema before upgrading.')
    table = sa.Table('post_appearances', sa.MetaData(), autoload_with=op.get_bind())
    # SQLite's inspector omits ON DELETE for some inline legacy FK syntax.
    # This relation has always been an orphan row owned by posts.id.
    for foreign_key in table.foreign_key_constraints:
        if ([column.name for column in foreign_key.columns] == ['post_id']
                and [element.target_fullname for element in foreign_key.elements] == ['posts.id']):
            foreign_key.ondelete = 'CASCADE'
    with op.batch_alter_table('post_appearances', copy_from=table) as batch:
        batch.drop_constraint('ck_post_appearance_material', type_='check')
        batch.create_check_constraint('ck_post_appearance_material', _CHECK)


def downgrade():
    raise RuntimeError('Saved material choices are user data; restore a verified backup to roll back.')

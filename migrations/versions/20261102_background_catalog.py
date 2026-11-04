"""Add persistent image backgrounds without replacing user content."""
from alembic import op
import sqlalchemy as sa

revision = '20261102_background_catalog'
down_revision = '20261031_reflective_materials'
branch_labels = None
depends_on = None


def upgrade():
    if 'background_catalog' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table('background_catalog',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('data', sa.Text(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.CheckConstraint('id=1', name='ck_background_catalog_singleton'))


def downgrade():
    raise RuntimeError('Background settings and originals are retained user data; restore a verified backup.')

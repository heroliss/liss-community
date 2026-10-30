"""Store optional post presentation without changing saved article content."""
from alembic import op
import sqlalchemy as sa

revision = '20261030_post_appearance'
down_revision = '20261024_owner_identity'
branch_labels = None
depends_on = None


def upgrade():
    # Public-demo preparation may already have created this additive table.
    if 'post_appearances' not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table('post_appearances',
            sa.Column('post_id', sa.Integer(), sa.ForeignKey('posts.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('theme_color', sa.String(7), nullable=False, server_default=''),
            sa.Column('card_material', sa.String(16), nullable=False, server_default='auto'),
            sa.CheckConstraint("card_material IN ('auto','glass','ceramic','paper','metal')", name='ck_post_appearance_material'),
            sa.CheckConstraint("theme_color = '' OR (length(theme_color) = 7 AND substr(theme_color,1,1) = '#')", name='ck_post_appearance_color_shape'))


def downgrade():
    raise RuntimeError('Saved post appearances are user data; restore a verified backup to roll back.')

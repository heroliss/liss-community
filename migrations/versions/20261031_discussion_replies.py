"""Add directed replies, correction timestamps and private reply notifications."""
from alembic import op
import sqlalchemy as sa

revision = '20261031_discussion_replies'
down_revision = '20261031_glass_finishes'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column['name'] for column in inspector.get_columns('comments')}
    if 'parent_id' not in columns:
        # Inline REFERENCES works for SQLite and PostgreSQL without rebuilding content.
        op.add_column('comments', sa.Column('parent_id', sa.Integer(), nullable=True))
        if bind.dialect.name == 'sqlite':
            # Public stores use the backed-up inline-FK preparation path. Generic
            # Alembic stores add their FK with SQLite batch table recreation.
            with op.batch_alter_table('comments') as batch:
                batch.create_foreign_key('fk_comments_parent_id', 'comments', ['parent_id'], ['id'])
        else:
            op.create_foreign_key('fk_comments_parent_id', 'comments', 'comments', ['parent_id'], ['id'])
    if 'edited_at' not in columns:
        op.add_column('comments', sa.Column('edited_at', sa.DateTime(), nullable=True))
    if 'reply_notifications' not in set(sa.inspect(bind).get_table_names()):
        op.create_table('reply_notifications',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('recipient_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('comment_id', sa.Integer(), sa.ForeignKey('comments.id'), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('read_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('recipient_id', 'comment_id', name='uq_reply_notification_recipient_comment'))
        op.create_index('ix_reply_notifications_recipient_id', 'reply_notifications', ['recipient_id'])
        op.create_index('ix_reply_notifications_comment_id', 'reply_notifications', ['comment_id'])
        op.create_index('ix_reply_notifications_recipient_read', 'reply_notifications', ['recipient_id', 'read_at'])


def downgrade():
    raise RuntimeError('Replies and notifications are user data; restore a verified backup to roll back.')

"""A successful submit acknowledges one browser draft without storing its text."""
import re

from flask import request, session
from flask_login import current_user


def record_writing_receipt(store=True):
    token = request.form.get('_writing_draft_token', '')
    if re.fullmatch(r'[0-9a-f]{32}', token):
        receipt = {
            'owner': str(current_user.id), 'path': request.path, 'token': token,
        }
        if request.endpoint == 'main.write':
            receipt['scope'] = '/'
        if request.endpoint == 'main.post':
            # The route has validated the parent and article before committing.
            # Scope follows that target, never a client-supplied scope or page.
            parent = request.form.get('reply_to', '')
            target = str(int(parent)) if parent else 'new'
            receipt['scope'] = f"/post/{request.view_args['id']}#reply:{target}"
        if store:
            session['writing_receipt'] = receipt
        return receipt
    return None

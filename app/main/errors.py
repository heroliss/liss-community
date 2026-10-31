from flask import render_template, request, jsonify
from flask_wtf.csrf import CSRFError
from . import main
from ..discussions import comment_json_request


@main.app_errorhandler(CSRFError)
def csrf_failure(e):
    if comment_json_request():
        return jsonify(ok=False, errors={'csrf_token': ['页面验证已失效，请刷新页面后重试。']}), 400
    return e.get_response()


@main.app_errorhandler(403)
def forbidden(e):
    if comment_json_request():
        return jsonify(ok=False, errors={'_form': [e.description or '当前身份无法发表评论。']}), 403
    if request.accept_mimetypes.accept_json and \
            not request.accept_mimetypes.accept_html:
        response = jsonify({'error': 'forbidden'})
        response.status_code = 403
        return response
    return render_template('403.html'), 403


@main.app_errorhandler(404)
def page_not_found(e):
    if comment_json_request():
        return jsonify(ok=False, errors={'_form': ['文章或回复目标当前不可见。']}), 404
    if request.accept_mimetypes.accept_json and \
            not request.accept_mimetypes.accept_html:
        response = jsonify({'error': 'not found'})
        response.status_code = 404
        return response
    return render_template('404.html'), 404


@main.app_errorhandler(500)
def internal_server_error(e):
    if request.accept_mimetypes.accept_json and \
            not request.accept_mimetypes.accept_html:
        response = jsonify({'error': 'internal server error'})
        response.status_code = 500
        return response
    return render_template('500.html'), 500

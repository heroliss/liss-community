from flask import current_app
from flask_wtf import FlaskForm
from wtforms import StringField, TextAreaField, BooleanField, SelectField,\
    SubmitField
from wtforms.validators import DataRequired, Length, Email, Regexp, Optional
from wtforms import ValidationError
from flask_pagedown.fields import PageDownField
from ..models import Role, User
from ..post_appearance import MATERIAL_CHOICES, apply_post_appearance, normalize_color


class NameForm(FlaskForm):
    name = StringField('你叫啥?', validators=[DataRequired()])
    submit = SubmitField('提交')


class EditProfileForm(FlaskForm):
    name = StringField('真实姓名', validators=[Length(0, 64)])
    location = StringField('地址', validators=[Length(0, 64)])
    about_me = TextAreaField('自我介绍')
    submit = SubmitField('提交')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if current_app.config.get('PUBLIC_DEMO'):
            self.name.label.text = '显示名称'
            self.location.label.text = '地区（可留空）'
            self.about_me.label.text = '个人简介'


class EditProfileAdminForm(FlaskForm):
    email = StringField('电子邮件', validators=[DataRequired(), Length(1, 64),
                                             Email()])
    username = StringField('用户名', validators=[
        DataRequired(), Length(1, 64), Regexp('^[A-Za-z][A-Za-z0-9_.]*$', 0,
                                          '用户名只能包含字母,数字，'
                                          '点和下划线')])
    confirmed = BooleanField('已验证')
    role = SelectField('用户角色', coerce=int)
    name = StringField('真实姓名', validators=[Length(0, 64)])
    location = StringField('地址', validators=[Length(0, 64)])
    about_me = TextAreaField('自我介绍')
    submit = SubmitField('提交')

    def __init__(self, user, *args, **kwargs):
        super(EditProfileAdminForm, self).__init__(*args, **kwargs)
        self.role.choices = [(role.id, role.name)
                             for role in Role.query.order_by(Role.name).all()]
        self.user = user

    def validate_email(self, field):
        if field.data != self.user.email and \
                User.query.filter_by(email=field.data).first():
            raise ValidationError('电子邮件已被注册')

    def validate_username(self, field):
        if field.data != self.user.username and \
                User.query.filter_by(username=field.data).first():
            raise ValidationError('用户名已被占用')


class PostForm(FlaskForm):
    body = PageDownField("你想说啥？", validators=[DataRequired()], render_kw={'rows': 10})
    appearance_color = StringField('卡片主题色', default='', validators=[Optional(strip_whitespace=False), Length(max=7)],
        description='留空自动安排。颜色仅用于协调的局部色调与光影。',
        render_kw={'maxlength': 7, 'placeholder': '自动，例如 #80bfa1', 'autocomplete': 'off'})
    appearance_material = SelectField('卡片材质', choices=MATERIAL_CHOICES, default='auto')
    submit = SubmitField('提交')

    def validate_appearance_color(self, field):
        try:
            field.data = normalize_color(field.data)
        except ValueError as error:
            raise ValidationError(str(error)) from error

    def save_appearance(self, post):
        # Older clients may edit body only. Omission must not erase saved style;
        # an explicit empty color + auto material is the intentional reset.
        color_present = bool(self.appearance_color.raw_data)
        material_present = bool(self.appearance_material.raw_data)
        if not color_present and not material_present:
            return
        saved = post.appearance
        color = self.appearance_color.data if color_present else (saved.theme_color if saved else '')
        material = self.appearance_material.data if material_present else (saved.card_material if saved else 'auto')
        apply_post_appearance(post, color, material)

    def load_appearance(self, post):
        if self.is_submitted():
            return
        saved = post.appearance
        self.appearance_color.data = saved.theme_color if saved else ''
        self.appearance_material.data = saved.card_material if saved else 'auto'

class CommentForm(FlaskForm):
    body = StringField('回复：', validators=[DataRequired()])
    submit = SubmitField('提交')

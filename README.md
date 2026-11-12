# Liss Community · 记录与交流

一个独立开发的 Flask 写作与交流网站。最初在 2016 年作为学习后端、前端和 Web 技术的实操项目，2026 年升级到 Python 3.13 / 3.14、Flask 3.1、SQLAlchemy 2.1，并重新设计为默认暗色、支持浅色切换的现代界面。

**[在线访问](https://liss.pythonanywhere.com/)** · **[源码](https://github.com/heroliss/liss-community)** · PythonAnywhere 免费托管 / HTTPS

无需注册即可用浏览器访客身份发文、编辑、评论、关注作者和完善资料。创建用户名与密码账号后，可在其他浏览器继续登录；从当前访客升级时保留同一用户 ID、全部文章、评论和关注关系。文章与身份长期存储，不会自动重置或清空。

站点作者使用可正常登录的真实账号，独立的作者标记与管理员权限共同展示身份。旧系统作者的文章、评论和关注可通过[有备份、可重复执行的合并命令](docs/admin.md#合并既有站点作者)归入同一个账号，保留原密码和邮箱；旧名字继续作为登录别名与主页跳转。

访客身份依靠当前浏览器的 Cookie；清除 Cookie、无痕浏览或换设备后可能无法认回，但已发布内容仍保留。邮件服务配置就绪后，提供可选邮箱绑定，支持验证邮件、重发、密码找回与绑定 / 更换邮箱。当前未配置真实发信时继续提供用户名注册，并明确提示；原用户名账号始终兼容。登录已有账号只切换身份，不自动合并当前访客内容。

## 作品与交流

当前源码随附51张经过 VOSR2 处理的图片背景与22种绘制背景，支持背景搜索、按需加载、观景模式和闲置自动隐藏。默认启用来访时随机，用户可设置自己的随机名单；站内跳转、刷新和历史返回保持画面，详见[背景与随机设置](docs/background-settings.md)。

新版已在正式站发布，正式源码以 `main` 为准。[v41 评论的散落／列表两种排版](docs/community-v41.md)支持记住选择、切换时保留阅读位置，并隔离首页文章的排版偏好；[v43 评论鼠标互动](docs/community-v43.md)采用克制的悬停与微倾斜。[v35 双视图文章流与阅读室页脚](docs/community-v35.md)和 [v34 紧凑评论与原地交流](docs/community-v34.md)继续提供文章卡片／列表切换、原地回复、按目标隔离的草稿、引用连线、多词搜索、作者与项目筛选及私人提醒管理。部署检查和已知验证边界见[检查与发布指南](docs/testing-and-release.md)。

[v40 评论层次与镜面、水面](docs/community-v40.md)把桌面引用放入独立右栏，定向回复保持一级缩进，长引用最多显示两行；回复框收到匹配的成功回执后自动收起，请求期间继续输入的文字保留。服务端和异步回复统一按从旧到新排列，新回复追加到底部。页脚以 `@Liss` 标识收尾，使用更透明、更宽的渐变融入背景。镜面与水面结合场景映像、细微磨损、透明水层和鼠标涟漪，提供模拟环境反射。v40 文档记录当时的本地验收，正式站现已采用后续版本。

[v39 的聊天气泡与轻量回复](docs/community-v39.md)、[v38 的全宽页脚](docs/community-v38.md)、[v37 的列表动效](docs/community-v37.md)和 [v36 的旧设计与全量验证](docs/community-v36.md)保留为历史记录，各轮报告只证明对应源码和记录范围。

十种具体材质为晶透玻璃、磨砂玻璃、温润釉面、纸册、石墨金属、皮革、软木、岩板、镜面、水面，另有“随站点安排”（`auto`），共 11 项选择。颜色与材质可预览并保存；正文、作者、项目关联和文章 URL 保留。镜面和水面使用模拟环境反射，未对其他材质统一叠加反射。已有存储升级前需一致备份，见[外观与迁移说明](docs/post-appearance.md)。

历史迭代分别记录在 [v19](docs/design-reading-room.md)、[v20](docs/design-material-studio.md)、[v21](docs/community-v21.md)、[v22](docs/community-v22.md)、[v23](docs/community-v23.md)、[v24](docs/community-v24.md)、[v25](docs/community-v25.md)、[v26](docs/community-v26.md)、[v27](docs/community-v27.md)、[v28](docs/community-v28.md)、[v29](docs/community-v29.md)、[v30](docs/community-v30.md)、[v31](docs/community-v31.md)、[v32](docs/community-v32.md)。旧报告只证明对应源码和记录范围。

作品展厅由 Astro 构建并部署到 [Liss Works](https://heroliss.github.io/liss-works/)，旧 `/works/` 入口重定向并保留路径。社区导航可以进入作品，24 项作品（包括玻璃海和盘序）各自有 `/projects/<slug>/talk/` 讨论页；这里发表的讨论属于真实文章，可在文章流阅读、继续评论并由原作者编辑。原文章保留，关联表只记录项目关系。

## 网站管理

已授权管理员登录原账号后，可从账户菜单进入 `/admin/`。后台提供文章预览与编辑、内容隐藏与恢复、用户角色和停用管理、站点介绍与写作规则设置，以及操作记录。背景图库支持上传PNG/JPG/WebP、改名与说明、排序、配色与焦点、默认随机名单、停用和移除恢复；原图保持私有，图库操作记录保留逐项前后差异。变更先预览再确认；隐藏保留原文，停用撤销已有会话，保护系统身份与最后一位管理员。

首次授权、数据库升级及测试方法见 [网站管理说明](docs/admin.md)。

后台的“访问统计”汇总社区、作品站与玻璃海的访客、IP、页面停留、滚动深度、点击、来源、设备与加载性能，提供实时访客、逐次访问轨迹、CSV 导出、IP 排除与手动清理，数据独立保存在 `analytics.sqlite`，见 [访问统计说明](docs/analytics.md)。后台不提供服务密钥编辑，也不提供永久清空内容的操作。

背景上传预算默认64 MiB，部署者可在既有私有配置中设置 `BACKGROUND_MAX_STORAGE_BYTES` 并重载。预算不能代替主机实际余量检查；含管理员上传图片的站点需将数据库和 `backgrounds/items/` 配套备份，具体命令见[部署维护指南](docs/public-demo.md#一致备份与显式恢复)。

邮箱验证 / 找回通过 Aliyun DirectMail、Brevo 或 Resend 的 HTTPS API，凭据仅放服务器私有配置。用途独立的签名链接 1 小时有效；密码重置会撤销其他旧登录会话。已有用户名账号可登录后绑定邮箱；从访客升级继续复用原用户 ID。完整配置步骤与免费服务限制见 [部署指南](docs/public-demo.md)。没有真实发信前，不将测试 outbox 结果当作投递成功。

## 运行

使用 Python 3.13 或 3.14，以及 Node.js 24（检查前端时需要）。在仓库目录执行：

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements/dev.txt
npm ci --ignore-scripts
.venv/Scripts/python -B scripts/check.py --frontend-only
.venv/Scripts/python -B scripts/serve_preview.py --port 8896
```

打开 http://127.0.0.1:8896/ 。当前工作区根目录可双击 `启动新版论坛.cmd`，或在 PowerShell 7 中运行 `./启动新版论坛.ps1`；它会检查现有本地服务。先查看终端给出的运行地址；端口已有服务时不要重复启动。

`serve_preview.py` 只监听本机，默认使用 `instance/local-preview/` 的独立 SQLite 和固定保存的本地密钥，关闭真实邮件与搜索收录，并创建明确标记的合成账号和示例内容。终端 Ctrl+C 停止；再次启动保留这份预览的数据和身份。此入口不读取正式服务私有配置。已有另一份隔离预览时，可用 `--data-dir <原预览目录>` 继续使用同一存储；不要把生产存储当作预览目录。完整用法可运行 `scripts/serve_preview.py --help`。

手动持久部署继续使用 `FLASK_CONFIG=public-demo`、原数据目录和固定 `SECRET_KEY`；`public-demo` 是历史内部配置名，产品界面使用 LISS。正式入口为 `/welcome`，旧 `/demo` 书签继续跳转。不要通过更换密钥或指定新空目录来更新已有站点。

PythonAnywhere 的 WSGI、现有存储升级、固定密钥、SQLite 一致备份与恢复见 **[部署与维护指南](docs/public-demo.md)**。已有部署的数据目录、私有配置与 Cookie 名保留兼容，仓库改名不会重置身份。公网使用 HTTPS 与正式 WSGI，继续保留 1 个 worker。

## 身份与边界

访客与注册账号都可发布、编辑自己的文章、评论、关注与维护资料。注册账号拥有更宽的写入配额并支持改密，访客无需邮箱或共享密码。普通身份不能覆盖其他作者的内容；新管理后台仅向有效的注册管理员开放，旧管理旁路和公共 REST API 继续关闭。所有写入口保留 CSRF 与适度限速，容量到限仅暂停新增或写入，不删除已有数据。

新版本在原 SQLite 中增加身份类型；迁移前自动生成一致备份，保留用户 ID、旧 Cookie 身份代次和关系。固定初始文章只有精确匹配未修改的旧种子内容时才更新为正式欢迎 / 写作说明，并先备份；用户内容不会被改写。旧 Heroku 数据没有找回，这次站点使用重新上线后积累的数据。

## 验证

2.0.0 的阶段改动见 [CHANGELOG.md](CHANGELOG.md)。统一检查还会核对全部内置背景的实物尺寸、字节数、缩略图和源码引用，并拒绝公共图片目录中的废弃派生图。原图、旧版超分与对比成果保留在工作区私有归档，不随网站发布。

```powershell
.venv/Scripts/python -m pip install -r requirements/dev.txt
npm ci --ignore-scripts
.venv/Scripts/python -B scripts/check.py
```

统一入口依次检查 Python 语法、生成资源与源码的一致性、第一方 JavaScript 语法、实际控制器场景和 Python 回归。`--frontend-only` 检查资源及前端；`--python-only` 只检查 Python；`--test tests.test_post_appearance` 可选定模块。每次报告和完整日志保存在 `.tmp/checks/<本次运行>/`。测试进程清除部署数据、密钥和邮件环境配置，禁用真实邮件，并校验仓库演示数据库没有变化。GitHub Actions 在 Python 3.13 / 3.14 与 Node.js 24 上运行同一入口，只做检查，不发布网站。

前端源文件清单位于 `assets/sources.json`。改动清单内的 CSS/JS 后运行 `npm run build`，审阅并一同提交源文件、`app/static/asset-manifest.json` 与 `app/static/bundles/` 的哈希生成物；`npm run check:assets` 仅核验，不重写。运行时若发现源码或生成物过期，会回退到带版本哈希的当前源文件，避免继续提供旧包。正式服务器使用仓库内已验证产物，运行 Flask 不需要 Node.js。

本地历次构建留下的旧哈希包可用 `npm run clean:assets` 预览，再用 `npm run clean:assets -- --write` 清理。命令先校验当前 manifest 的全部资源，只删除同组、内容哈希匹配且未被引用的生成包；不碰源文件、资料或存储。构建和清理应分开执行，发布环境的旧包应在更新完成且旧页面不再依赖它们后另行清理。完整说明见[前端资源维护](docs/testing-and-release.md#前端资源构建)。

回归覆盖模型、权限、表单与 CSRF、访客隔离、账号、迁移、重启、配额、WAL 一致备份和恢复。Node 场景运行实际控制器，覆盖背景请求取消、写作展开、文章返回与外观保存状态；VM 场景不证明浏览器布局或 GPU 表现。历史 Selenium 用例仍为显式选择；完整浏览器及真机验收按[检查与发布指南](docs/testing-and-release.md)单独记录。

Docker、生产 PostgreSQL 和真实手机/Safari 的结果不能从这些测试推断。生产邮箱已经启用，但本地检查禁止发信；真实收件箱送达需要在发布验收中另行实测。

## 技术与兼容

- Flask Blueprint、Jinja、SQLAlchemy、Flask-Login / WTF、Markdown + Bleach、REST API 与角色权限，前端支持实时预览和深浅主题。
- Flask-Script 已迁移至 Flask / Click CLI，适配现代分页、查询记录、WTForms、Faker 与 Bleach CSSSanitizer。
- 使用带时效签名令牌，现代 Werkzeug 密码散列字段扩为 256 字符；保留历史密码验证和 naive UTC 数据约定。
- 访客和账号类型持久化，公开站使用可选 HTTPS 事务邮件，无 SMTP 依赖；普通开发 / 生产模式保留原邮件机制。
- `app/` 为应用与接口，`migrations/` 为原迁移链与新版增量，`tests/` 为回归测试，`manage.py` / `deploy/` 为管理和部署入口。

普通开发使用 `development` + `DEV_DATABASE_URL`，空库执行 `python manage.py deploy` 升级迁移并初始化角色。独立本地开发样例可使用 `demo`、`seed-demo` 和 `demo@example.com` / `local-demo-only`；该密码不适用于公开站。生产 / Heroku 模式需自行配置数据库、固定 SECRET_KEY 与邮件；`requirements/heroku.txt` 提供 Gunicorn / psycopg 3 可选依赖。

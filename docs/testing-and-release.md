# 当前检查、预览与发布

本文是当前操作入口。[v34](community-v34.md) 记录评论、搜索和提醒，[v35](community-v35.md) 记录文章双视图，[v41](community-v41.md) 和 [v43](community-v43.md) 记录评论两种排版及鼠标互动。各版本文档保留对应设计及当时的测试，不把历史结果当作当前提交的验收。正式版本以 `main` 的已发布提交、服务实际响应和对应验收记录为准。

## 本地预览

在仓库目录安装依赖并启动：

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements/dev.txt
npm ci --ignore-scripts
.venv/Scripts/python -B scripts/check.py --frontend-only
.venv/Scripts/python -B scripts/serve_preview.py --port 8896
```

当前工作区根目录可双击 `启动新版论坛.cmd`，也可在 PowerShell 7 中运行 `./启动新版论坛.ps1`。先检查已有服务；该脚本保留现有运行实例时，直接使用提示的地址。Python 入口仅监听 `127.0.0.1`，不会开放局域网访问。

默认数据目录为 `instance/local-preview/`；密钥首次生成后保存在同一目录。新预览含明确标记的合成账号、指南和评论，禁止真实发信，强制不被搜索收录。重复启动保留预览数据。需要沿用已有隔离库时，用 `--data-dir <已有预览目录>` 指定同一目录；不要指向生产数据目录，不要为“升级”更换预览密钥。

全新预览的合成管理员为 `qa_liss`，普通账号为 `qa_reader`，两者密码均为 `Local-Preview-Only-17!`。这些固定凭据只用于本机合成数据，不适用于正式站；沿用已有隔离库时保留该库原账号状态。

```powershell
.venv/Scripts/python -B scripts/smoke_http.py http://127.0.0.1:8896 --preview
```

此命令只进行匿名 GET，检查健康页、首页、欢迎页、登录页、项目讨论及后台权限，并要求本地预览标记与 `noindex`。已知文章可以追加 `--post-id 123`，应替换为预览中实际存在的 ID。它不登录、不提交文章、不发信，不能代替完整浏览器交互。

## 一个命令运行自动检查

Python 使用 3.13 或 3.14；前端检查使用 Node.js 24。

```powershell
npm ci --ignore-scripts
.venv/Scripts/python -B scripts/check.py
.venv/Scripts/python -B scripts/check.py --frontend-only
.venv/Scripts/python -B scripts/check.py --python-only
.venv/Scripts/python -B scripts/check.py --test tests.test_post_appearance
```

`check.py` 不带选项时执行完整检查；其余选项用于对应范围的快速检查。它们写入唯一的 `.tmp/checks/<运行时间与随机后缀>/`，包括 `summary.json` 和每阶段原始日志。失败返回非零退出码；警告保留在日志中。测试子进程清除正式数据、密钥、数据库、邮件与 Flask 环境变量，并显式关闭邮件与收录。检查前后校验仓库演示数据库的哈希。

前端检查首先运行 `npm run check:assets`，核对源码、manifest 与生成资源完全匹配；缺少依赖会明确提示运行 `npm ci --ignore-scripts`，过期生成物会失败并提示重建。接着检查第一方 JS 的语法和 `scripts/tests/*.test.cjs` 的场景。保留的场景直接加载仓库实际控制器，检查请求取消/解码竞态、存储不可用、写作展开中断、减少动态、清理、原生文章返回与外观预览状态；不依赖工作区外的验证目录、历史 Git 提交或原始测试截图。它们不模拟一次浏览器成功，不证明真实布局、触摸、色彩对比或 GPU 成本。

`.github/workflows/checks.yml` 对推送、PR 和手动运行使用同一命令，矩阵为 Python 3.13 / 3.14 与 Node.js 24。CI 先执行 `npm ci --ignore-scripts` 与独立的 `npm run check:assets` 门禁，再执行统一检查。Actions 固定提交 SHA，只有读取源码权限，日志产物保留 14 天。CI 不持有生产凭据，也不自动发布。新增控制器回归放入 `scripts/tests/*.test.cjs`；应测试实际输入、事件及状态变化，不复制实现公式来“证明”自己。

## 前端资源构建

`assets/sources.json` 声明分组及原始顺序，`package-lock.json` 锁定构建依赖。开发者改动清单内 CSS/JS 后执行：

```powershell
npm ci --ignore-scripts
npm run build
npm run check:assets
```

`build` 合并压缩各组并输出内容哈希文件名，同时记录每个输入与产物的 SHA-256。应一同提交源码、manifest 和 `app/static/bundles/` 生成物；检查命令会拒绝缺失、被改写或过期的包，不会自动“修好”提交。原始源文件保留可维护性和开发时回退，不直接编辑压缩生成物。

Flask 的资源解析器在源码/产物哈希与 manifest 相符时使用生成包；源改了但未重建、manifest 缺失或包内容不符时，回退到当前源文件并添加版本哈希。这个回退让本地编辑不会继续服务旧界面，但不代替发布门禁。构建在开发或 CI 中完成，服务器只需部署已验证的源码与生成物，Flask 运行不依赖 Node.js。

构建保留旧哈希包，避免更新过程中提前移除旧页面资源。完成本地验证后，可显式查看和清理未引用生成物：

```powershell
npm run check:assets
npm run clean:assets
npm run clean:assets -- --write
```

默认命令只列出计划；`--write` 才删除。清理要求当前 manifest 完整且所有当前包的 SHA-256 匹配，保留当前包，仅处理当前分组内、严格匹配哈希命名且实际内容哈希一致的旧 `.js` / `.css` 文件。未知文件、退役分组、被改写文件、目录与符号链接原样保留；清理不递归，不涉及源文件、截图、数据库、私有配置或其他目录。manifest 无效或构建中发生变化会停止；不要与构建同时运行。发布服务器保留旧包的时长取决于旧页面的存活情况，不应在发布前自动删除。仓库检查中的 `asset-cleanup.test.cjs` 用隔离临时目录验证保留、拒绝异常输入、实际清理与重复执行。

## 真实浏览器与设备验收

每次记录提交、浏览器/版本、设备、分辨率、输入方式、背景/主题和实际结果。失败截图与复现步骤保留；没有可用设备的格子明确记为“未验证”。视口模拟不替代真实触屏、系统软键盘或 Safari。

| 场景 | 可执行操作与通过条件 |
| --- | --- |
| 核心写作 | 登录或创建隔离访客；输入中文并使用输入法候选；预览、分屏、全屏、退出；发布后只出现一篇；编辑与评论仍可用 |
| 草稿 | 输入正文与材质后刷新/误导航，能恢复当前身份和当前页面的草稿；成功提交后不复活旧稿；更换身份不显示上一身份正文；存储被禁用时仍可写作并提示未保存 |
| 阅读与返回 | 列表打开文章、原生 Back、普通返回链接、图片查看、Escape；返回位置稳定，无遮罩或滚动锁残留 |
| 可读性 | 深浅主题分别组合明亮照片、暗照片、程序背景、八种材质；正文、评论提示、占位符、焦点和按钮都有稳定对比 |
| 无障碍与降级 | 仅键盘完成导航/写作/图片关闭；系统减少动态即时生效；全局暂停；禁用 JS 仍可读与提交普通表单；WebGL 不可用仍有可读表面 |
| 真正手机 | 至少一台实际 Android 或 iPhone；竖横屏、触屏滚动、点击、长按选字、中文输入法与软键盘遮挡；隐藏/返回应用后不丢输入 |
| 跨浏览器 | Chromium、Firefox、Safari 分别检查核心流程；不支持 View Transition 时普通链接、历史与表单照常工作 |
| 实际性能 | 对低性能条件下的长列表滚动、写作输入、图片切换做 Performance 采样，记录长任务和延迟；比较同设备同场景前后差异，不从 RAF 频率推断 GPU 耗时 |

当前执行环境没有外接真实手机或 Safari 时，可以完成本机 Chromium、视口模拟及自动检查，并把其余项保留为待设备验收。不要将这份清单或 VM 通过状态写成“全设备通过”。

## 收录与分享

`LISS_INDEXING_ENABLED` 默认关闭；本地预览始终关闭。公开服务只有在明确设置 `LISS_INDEXING_ENABLED=1` 并配置正式的 `LISS_PUBLIC_BASE_URL` 后，才按公开路由策略允许收录。登录、账号、后台、编辑、搜索结果与预览保持 `noindex`；隐藏内容不能因 metadata 或 sitemap 重新暴露。

分享标题、摘要和 canonical 来自实际公开文章，不能直接信任请求 Host 或正文里的 HTML。部署者应检查实际响应的 `X-Robots-Tag`、canonical、Open Graph URL 和摘要；私有 JSON 的允许配置项应和 WSGI/管理脚本同步。开启收录不会自动让搜索引擎立即收录，`noindex` 也不能代替内容访问权限。

## 受控发布与迁移演练

1. 冻结候选提交，确认工作区和当前线上提交，运行完整自动检查，并完成可用设备上的浏览器验收。检查日志对应这一个提交；修改后针对影响范围重验。
2. 使用服务器原有管理配置，通过 SQLite backup API 创建一致快照，核验 `quick_check`，另行安全保存私有配置和固定 `SECRET_KEY`。保留原数据目录、Cookie 名和身份代次。
3. 将快照放到私有本地目录，用当前源码升级副本并对照原表、原列和原行。输出目录必须是全新目录，里面含完整私有数据，不提交到 Git：

```powershell
.venv/Scripts/python -B scripts/rehearse_upgrade.py --snapshot <一致快照.sqlite> --output-dir <新的私有演练目录>
```

脚本以只读方式打开源快照，经 backup API 创建副本，清除线上环境后运行同一 `public-demo` 存储准备流程。报告包含检查布尔、表名、计数、新增列与安全快照文件名；失败只记录固定说明与异常类型，不写原始异常消息、原行值、密码散列或密钥。允许新增表/列，但所有旧列及旧行值必须保持（仅忽略 `users.last_seen` 和迁移版本元数据）；检查外键、完整性与源快照哈希。未知旧约束或保留失败应停止发布并检查，不继续覆盖真实数据。

应核对演练实际发生了哪些迁移。已经是九项材质约束的 v32 快照只能证明现有材质数据保留，不能证明五项或八项目录的升级；缺少回复列的旧快照则可实际覆盖 `comments.parent_id/edited_at` 的新增和通知表建立。报告中的 `added_columns`、`added_tables`、`appearance_table_definition_changed` 与 `safety_backups_created` 用于区分这些范围，不把无操作准备写成所有历史迁移均通过。

4. 对 `public-demo` 部署按既有 [部署维护流程](public-demo.md#一致备份与显式恢复) 更新指定候选提交、安装锁定依赖、运行准备命令并 Reload。普通非 `public-demo` Alembic 部署应用完整迁移链；外观迁移包含 `20261030_post_appearance`、`20261031_material_catalog`、`20261031_glass_finishes`，当前 head 以代码为准。
5. 先运行匿名烟测，再由授权账号实际验收登录、旧文章/评论/关注、发帖/编辑/定向回复、未读提醒、个人评论纠错、后台确认、材质保存及 Reload 后保留。涉及邮件时使用授权收件箱实收验证；本地 outbox 不算真实送达。记录服务提交与结果。
6. 保留发布前快照和上一源码版本。仅前端失败且旧代码兼容新增 schema 时，可以回退源码；需要恢复数据库时先备份当前新增内容，再按显式恢复流程执行，说明恢复会撤销旧 Cookie、快照后的内容不在恢复结果中。不要用清空数据或轮换密钥代替回退。

本地演练不能证明生产空间、平台配额、邮件服务、DNS/HTTPS 或真实用户浏览器均可用。生产更新和内容操作在授权范围内单独执行，自动 CI 不承担这些动作。

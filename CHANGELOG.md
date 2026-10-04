# Version notes / 版本说明

## 原图标记与角标核对复用 / Diagram markings and evidence · 2026-10-05
- 两阶段几何重绘保留原图角号、明确角值、边长及图下注释；复杂或不确定标记使用图注兜底，不把猜测作为题设。
- 会话重绘复用已有识图题设与角标核对，区分机器记录、独立AI核对和人工修订/补充；不增加识图调用，不凭射线猜角区。
- 标记与图注随锁定底图、SVG导出、独立阅读和文字/PNG分享保留；旧图不自动重跑。
- Preserve explicit diagram markings and captions across locked construction stages and exports; reuse answer-paired angle evidence with human corrections taking precedence. No extra recognition call or automatic redraw of old diagrams.

## 阅读与分享维护 / Reading and sharing · 2026-10-05
- 参考答案与解题思路增加适宽阅读模式；独立阅读页直接使用当前附件勾选状态分享，文字面板可重复展开与收起。
- 文字分享默认保留LaTeX，可关闭并提示公式可能不准确；图片位置提供使用图片分享的提示。
- 默认附带参考答案及有效第二步辅助线图，不附带题干；手动勾选题干时优先联动原题重绘，否则联动原图，图片可独立取消。
- 收紧普通作图与分享图片留白，固定两阶段底图位置和比例，补全长标签导出边界；多张长图集中下载并连续预览，手工裁切原图不改。
- 丰富中英文README与合成数据界面截图，明确模型能力、生成效果和本地分享边界。
- Add fit-to-width reading and inline reader sharing, optional LaTeX text export, independent attachments with event-only question/image selection, compact diagrams, grouped PNG downloads, and refreshed bilingual documentation.

## 功能与维护更新 / Features and maintenance · 2026-10-04
- 新增MiniMax文生图与参考图识别描述，复用已保存的官方连接，并保持图片输出单独授权；实验性重新配图独立弹窗使用，不保证底图或几何精度不变。
- AI处理与图片生成增加等待进度提示；几何作图按底图、纠正说明、辅助步骤从上到下展示，原图对照按需展开。
- 图形统一左对齐，宽屏公式缩进左对齐、小屏居中；解题可在独立标签页阅读并在本机分享文字或长图，按需附带题干、原图、原题重绘、参考答案及辅助线图，不创建公开链接。
- 修复分享弹窗关闭按钮随滚动偏移，独立阅读页移除重复的新标签入口，保留分享操作。
- Add separately authorized MiniMax illustration generation, reference-image descriptions, progress indicators, sequential drawing UI, responsive reading, and local text/image sharing. Fix scrolling close controls and redundant reader links; no public sharing endpoint is introduced.

## 维护更新 / Maintenance update · 2026-10-02
- AI配置导入：文件选择按钮增加边框与浅蓝底色；补充vision为文字＋读图能力、不会自动授权图片编辑的提示与回归测试。
- 弹窗：共享关闭按钮改为浅红圆形悬浮按钮，滚动时保持可点击，hover加深。
- 网站图标：浅蓝背景、放大的书本、蓝色横线与橙红对勾，保留右上角四角星；同步SVG、PNG、ICO与主题色。
- AI import: improve file-picker affordance and clarify that vision does not grant image-edit authorization; add compatibility regression coverage.
- Dialogs and branding: keep the red-tinted close button accessible while scrolling, and refresh all site-icon formats with the approved larger-book design.

## 维护更新 / Maintenance update · 2026-09-29
- 辅助线维护：固定底图视窗不变，新增在新标签页打开当前步骤完整图；下载SVG也包含越界辅助点，不提前展示后续步骤。
- Drawing maintenance: keep the embedded source viewport fixed and open the complete current-step SVG in a new tab. Downloads include outlying auxiliary points without revealing future steps.
- 底图增加纠正说明，可携带原题和原图显式重绘第一步；不向底图AI发送答案或解析。成功后清除旧辅助步骤并重新核对锁定，失败保留旧图；修改说明不会自动调用AI。
- Source corrections can be submitted with the original question and image for an explicit first-stage redraw, without sending the solution to the source AI. Successful redraws clear obsolete auxiliary steps and require confirmation again; failures preserve the old drawing. Editing a correction alone never calls AI.

- 辅助线改为两个独立任务：先仅按原题重建底图（有图强制使用识图链），用户核对锁定后才请求新增构造；第二步只接受steps，拒绝改写底图坐标、边、圆弧或标题。SVG视窗仅由底图确定，GeoGebra原有对象固定；历史底图任务可取回继续。
- Auxiliary drawing now uses two explicit jobs: reconstruct and confirm the source first, then append validated steps only. Image-bearing source reconstruction requires the vision chain. Original geometry and the SVG viewport remain fixed; saved source jobs can be resumed without regenerating the base.
- 解题、复核及自定义模板补充尺规构造依据：先给合法作法，再证明角度/等长性质；新增轴对称reflect操作，不能把数值角或软件旋转参数冒充尺规证明。AI整图编辑明确标为不能保证底图不变的独立实验功能。
- Teaching prompts require justified straightedge-and-compass constructions before proving their properties, including for custom templates. A reflection operation supports synthetic constructions. Whole-image AI editing remains experimental and is explicitly not an immutable-source mode.

- 历史任务维护：列表仅读摘要、慢请求不再重叠，已初始化的权限读取不再重复写配置；仍实时校验账号和模型授权。详情区分超时、登录、授权、过期及服务异常，失败作图不再宣称有预览。
- Task-history maintenance: fetch metadata-only lists, serialize refreshes and avoid redundant configuration writes while preserving live account/model checks. Read failures distinguish timeout, authentication, authorization, expiry and service issues; failed drawings no longer claim a preview.
- 保留关键角标独立核对，明确区分关键角标疑问与普通转录疑问；已核清全部编号角时，由解题阶段判断其他疑问是否影响答案。旧转录仍保守兼容，不增加自动补读或放过关键条件冲突。
- Keep independent checks of critical angle labels while separating unresolved angle evidence from generic transcription doubts. Once all labels are confirmed, the solver assesses the relevance of other doubts. Legacy records remain conservative, with no extra automatic rereads or bypass of critical conflicts.
- 构造提示补齐严格JSON形状与字段范围；新增字段、点名/坐标、操作和范围诊断。最终预算耗尽仍保留最后失败调用的安全格式诊断，不输出私密模型原文或擅自修正几何。
- Construction prompts now specify strict JSON shapes and bounds. Safe diagnostics distinguish fields, points/coordinates, operations and limits, and preserve the final parse failure when the overall budget is exhausted without exposing private output or altering geometry.

- 辅助线维护：消除底图点与步骤新建点定义冲突，补齐构造操作的JSON示例；保持几何白名单与严格校验。
- Auxiliary drawing maintenance: clarify original versus step-created points and provide compilable JSON examples for all supported operations without weakening validation.
- 作图页显示已有的安全细分诊断，区分无效构造、格式、限流、超时及图片输出问题；不展示上游私密正文、不自动重复提交收费任务。
- Drawing failures now surface safe, final-attempt diagnostics for geometry, format, rate-limit, timeout and image-output errors. Private upstream output remains hidden, with no added automatic resubmission.

- 核对区域的补充文字与原识图题设一起解题，不再被旧角标核对状态反复拦截；支持先保存再继续，仍对实际缺失条件、归属、版本冲突和调用预算作校验。
- Human supplements are retained alongside the original transcription and passed to the solver as reviewed evidence. Saving does not invoke AI; replacing the image or the complete transcription clears superseded supplements.
- 原图对照与完整识图转录默认展开，仍可收起；分步解答和步骤标题的Markdown粗体显示补齐。
- Evidence panels open by default and remain collapsible. Step headings render in bold, including Markdown heading levels four through six.
- 初次解题、独立复核和重新解答共用适龄解法策略；小学奥数优先有效的算术、辅助线及综合几何证明，不仅为计算方便改用三角函数数值或解析几何，正确性仍优先。
- Solving and review share grade-appropriate method guidance, prioritizing accessible arithmetic and synthetic geometry for primary-school/Olympiad questions. Higher-level methods remain available when genuinely needed or explicitly requested; numerical agreement is not a proof.
- 用户注册和改密最少8位，保留72个UTF-8字节上限；不改变首次部署管理员密码要求、旧密码登录兼容、Turnstile或AI配置导出限制。
- Registration and password changes accept eight or more characters, retaining the 72-byte UTF-8 limit. Initial deployment credentials, legacy login compatibility, Turnstile and AI-export restrictions are unchanged.
- 本批修复无需新增数据库迁移；源码、镜像发布与实际部署分别核验，不因源码更新宣称线上已升级。

## 用户系统 / User management · 2026-09-27

> 以下为用户系统源码变更。2026-09-27用户确认本地真实验证成功并授权推送GitHub；镜像发布、Zeabur升级与线上验收仍是独立步骤。User-system source changes; local real verification was confirmed and GitHub publication authorized on 2026-09-27. Image publication, Zeabur upgrades, and production acceptance remain separate steps.

- 登录与注册均强制服务端Turnstile校验；缺配置、错误action/hostname或验证失败时拒绝。升级前必须先准备站点与服务端环境变量，无生产绕过开关。
- 注册默认关闭；邀请码默认30天、1次，可续期/停用并选择是否在注册框公开显示。自注册默认7天试用，管理员可设7天/30天/永久；手建默认永久，已有账号期限不追溯修改。
- 新增用户管理、一次性临时密码、强制改密、会话即时撤销与并发保护；到期禁止受保护页面/API，到期满30天分批清理，保留最后一个管理员恢复账号但不恢复访问权。
- 站点AI采用新账号默认3项授权快照（可用项不足3项时全选），管理员可追加/撤销授权；用户可添加、编辑、导入本人私有AI。站点密钥不返回普通用户。
- 所有角色默认禁用AI配置导出；仅部署环境变量`SOLVNOTE_ENABLE_AI_CONFIG_EXPORT=true`恢复管理员加密导出。保留导入与无密钥格式模板；站点导入预览确认、个人导入CAS隔离。
- Docker构建上下文只放行公开AI格式模板，避免模板接口在镜像编译时缺文件；继续排除其余文档、私密配置和本地数据库。
- Docker builds include only the public AI import-format template from the documentation tree, keeping private configuration and local databases excluded.
- Both login and registration require server-validated Turnstile. Missing configuration or an invalid token/action/hostname fails closed; configure the site and server variables before upgrading. There is no production bypass.
- Registration is closed by default. Invitations default to 30 days and one use, support renewal/deactivation and optional public autofill. Self-registration defaults to a seven-day trial; administrators can choose seven days, 30 days, or permanent. Administrator-created accounts default to permanent; existing accounts are unchanged.
- Account management adds one-time temporary passwords, mandatory password changes, live session revocation and concurrent-write protection. Expired accounts lose protected site/API access and are purged in batches after 30 days, except the final administrator recovery record, which remains blocked.
- New accounts receive a snapshot of three default site models (all eligible models when fewer than three exist). Administrators can grant/revoke additional access; users can edit/import their own private AI configuration without receiving site credentials.
- AI export is disabled for every role by default. Only explicit `SOLVNOTE_ENABLE_AI_CONFIG_EXPORT=true` restores administrator-only encrypted export. Imports and a key-free template remain available, with preview/confirmation for site imports and isolated CAS writes for private imports.

## 2.0.0-yus.2 · 2026-09-26

- 公告由前端硬编码改为管理员后台维护；新增发布状态、置顶顺序、时间窗口与中英文纯文本预览。
- 公告列表增加置顶/取消置顶、隐藏/恢复发布和带二次确认的永久删除；删除仅清除该公告及其已阅记录，带版本冲突保护。快捷操作不需要新增迁移。
- Announcement list actions support pin/unpin, hide/republish and confirmed permanent deletion of a notice with its read receipts. Revision checks prevent stale changes; no additional migration is required for these actions.
- Per-account explicit acknowledgement: ordinary notices move to history, read-and-hide affects only the reader, and persistent notices stay without an unread badge. Editing or republishing preserves receipts.
- 站内全体启用账号可见；后台权限核对当前账号状态，限制同源写入、输入大小、站内链接，并防止管理员并发覆盖。
- Additive migration creates Announcement and AnnouncementRead and imports the three previous notices once. Existing learning/configuration tables are not rebuilt. Ship the matching generated Prisma client, schema and build together.
- 升级需先停写配对备份；错题本JSON不含公告/已阅状态。该源码版本不表示4318或线上已经升级。


## 2.0.0-yus.1 · 2026-09-26

本节描述源码改动，不承诺同版本GitHub发行包或镜像已经发布。This documents source changes; it does not guarantee a matching published release or image.

- 解题记录独立入口：受理即保存，20条游标分页与状态筛选，3秒刷新。多轮追问计同一会话，与存入错题本分离。
- Conversations, direct solves and reanswers are retained long-term. Temporary drawings and practice-generation tasks keep their 24-hour retention. Existing surviving legacy solves remain readable; purged history cannot be restored. Expired queued solves never restart automatically.
- 解题统计覆盖全部保存记录，区分完成、待补充、处理中、未完成及取消；显示近6个月北京时间新增趋势和已记录AI调用，不推算答案正确率或费用。
- Solving, notebook-entry and review-practice statistics remain separate. Follow-ups do not inflate the solving-record count.
- 更新解迹·SolvNote站点标题、原创图标、公告和中英设置说明；关于指向本仓库，保留wttwins上游署名。
- Prompt templates explicitly cover direct analysis and practice generation, not conversation, reanswer, recognition or drawing prompts. Destructive action permissions and deletion scope are unchanged.
- 错题本JSON导出不包含解题会话、AI任务、AI凭据或部署设置；完整备份需停止写入后配对保存数据库、配置及原秘密变量（含加密主钥）。长期保留不是备份。
- 已结束历史会话不占100条未结束会话额度，避免为继续解题被迫删除历史；并发队列限制保持不变。
- No schema migration is required. Existing deployments do not change until their code/build is explicitly upgraded.

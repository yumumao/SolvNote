# Version notes / 版本说明
## Unreleased · 2026-09-27

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

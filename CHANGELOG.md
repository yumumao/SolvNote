# Version notes / 版本说明

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

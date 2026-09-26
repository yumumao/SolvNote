# 公告管理 / Announcement management

## 使用口径

- 管理入口：管理后台或设置的管理员栏目 → 公告管理；用户入口：首页铃铛或`/announcements`。
- 发布状态与排序、阅读策略独立。只有已发布且在有效期内的公告可见，生效时间包含边界，到期时间不包含边界。管理员时间输入采用当前设备时区，后台保存统一时间。
- 普通公告已阅后进入历史；读后隐藏仅从该用户视野移除；常驻公告仍在通知列表但不再计入未读。打开菜单、点击关联页面不构成确认已阅。
- 管理员可在列表直接置顶/取消置顶、隐藏/恢复发布；直接删除需二次确认，是不可恢复的永久删除，并会级联删除该公告的已阅记录。一般业务优先使用隐藏或归档。草稿、隐藏、归档、未生效及已过期公告不会从用户接口返回，历史列表亦如此。
- 快捷置顶不会自动发布草稿、隐藏或归档公告；隐藏/恢复发布按钮仅用于已发布/隐藏公告，恢复后仍按原有效期与阅读策略展示。快捷操作仅改目标字段，不覆盖正文、时间或阅读策略；删除、快捷操作与编辑共享版本冲突保护。删除或隐藏筛选末页最后一条后自动退回有效页。
- 已阅跟随账号跨设备保存，通知列表每30秒串行刷新并可手动刷新。编辑、隐藏、归档或重新发布都不清空已阅状态；要通知所有人，请新建公告。变更阅读策略后已有已阅记录按新策略展示。
- 仅站内通知，默认面向全部启用的已登录账号。第一版不含指定个人/分组受众、邮件、微信或浏览器系统推送，不收集逐用户阅读报表。
- 正文按纯文本展示，不执行HTML；英文留空回退中文，不自动翻译；链接只接受站内路径。管理员冲突时保留编辑草稿，需重新读取最新版本后再修改。

列表快捷操作不新增表或字段，已安装公告两表的实例只需更新程序构建，不必重跑旧升级器；本地更新仍需单独授权。

## 部署与备份

`2.0.0-yus.2`新增`20260926010000_announcements`迁移，只创建`Announcement`、`AnnouncementRead`和索引，并一次性转入原三条内置公告。不重建学习或AI配置表。重复执行迁移不会覆盖已编辑公告。

先停止写入、保留数据库及其必要日志状态、配置与原秘密环境变量的配对备份，再按既有部署流程应用迁移，配套安装程序/schema/新生成的Prisma客户端。不要对运行实例共用的node_modules原地执行prisma generate。错题本JSON不含公告和已阅状态。

回退优先切回旧程序及旧客户端；新增表可保留，不能盲目删除。若恢复整库旧备份，会丢失备份以后写入的数据，必须再次确认，不能作为自动回退默认动作。当前源码完成与本地升级、线上发布是三个独立状态。

## English summary

Admin: `/admin/announcements`; readers: home bell or `/announcements`. Publication state, pin order and read policy are independent. Only published notices within their visibility window are returned. Administrators can directly pin/unpin and hide/republish from the list. Direct deletion requires confirmation, is permanent, and cascades to that notice's read receipts; use hide or archive when the record may be needed. Reading is explicitly acknowledged per account; opening the list or following a link is not acknowledgement. Ordinary read notices move to history; hide-on-read notices disappear only for that reader; persistent notices stay but no longer count as unread. Administrators keep non-deleted notices.

Pinning does not publish a draft, hidden or archived notice. Hide/republish is offered only for published/hidden notices and preserves the time window and read policy. Quick actions update only the intended fields; all writes, including deletion, reject stale revisions. Empty last pages return to a valid page. These actions need no migration beyond the announcement tables already introduced.

Read receipts survive edits, hiding and republication. Create a new notice to notify everyone again. The first version covers all active signed-in users, plain text, optional English fallback, same-site links, pagination and 30-second serial refresh, without external push channels or per-user analytics.

Deploy the additive migration, matching generated Prisma client, schema and build together after a paired backup and stopping writes. Never regenerate shared dependencies under a running instance. Notebook JSON does not export notices or receipts. Restoring an old full database can discard later writes and requires explicit authorization.

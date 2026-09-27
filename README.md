# 解迹 · SolvNote

**简体中文** | [English](README.en.md)

**在线演示**：[solvnote.n29.net](https://solvnote.n29.net/)（公开演示实例，数据与服务稳定性不作保证。） 建议仅使用不含隐私的题目测试，不要在演示站配置自己的AI密钥或保存敏感资料。

**不止拍照出答案，更要讲清怎么想到、为什么成立、下次怎样自己做。**

基于[wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook)继续开发，保留账户、学科错题本、裁剪上传、知识点、练习和打印，重点增强图文解析、多轮追问、几何辅助线与AI配置互通。

[解析特色](#解析不止是答案) · [快速上手](#快速上手) · [部署](#部署) · [常见问题](#常见问题) · [技术文档](#技术文档与来源)

![功能流程示意：读准题目→讲清思路→追问纠错→存题复习](docs/images/learning-workflow.svg)

## 解析，不止是答案

这里的重点不是在聊天框里再给一次答案，而是把**可核对的题设、可理解的讲解、可追问的过程和可复习的错题记录**放在一起。

|你关心的事|本项目的做法|
|---|---|
|为什么想到这一步？|先讲思路，再用有标题的步骤推导，交代依据，最后检验与总结；不只罗列计算式。|
|能不能用更容易理解的方法？|年级是讲解起点，不是知识上限。优先最低必要知识；能用初等几何严谨解决时，不默认改用坐标计算。确需升阶，再解释新概念。|
|题图有没有读错？|保留原图供核对；支持图片的解题模型会同时收到原图。图像疑点优先补读，真缺条件再问人，人工修订优先。|
|看不懂、不同意，怎么办？|围绕同一道题继续追问、补图或纠错。默认10轮，管理员可调整默认值，并在到限提醒后确认追加。|
|下次怎样不再错？|区分不会做、做错了、未判断；记录错误解答原文，编辑错因与知识点。没有作答证据时，不编造个人错因。|

![讲解结构示意：思路说明选法，步骤写清依据，检验核对题设，总结提炼方法](docs/images/explanation-guide.svg)

**题目内容、参考答案、解题思路分区显示，默认预览Markdown与数学公式，标记源码按需展开。**结果可以直接编辑、添加到错题本，不必在聊天窗口和另一个编辑器之间来回搬运。

<details>
<summary>查看实际界面：公式排版、分步解析与错因编辑</summary>

![合成示例的实际界面：题目、答案、解析的公式预览及可编辑错因](docs/images/formula-result.webp)

</details>

> 上面的两张图是功能与讲解结构示意；界面截图使用合成示例。讲解规则不是正确率保证，题设、推导和图形仍需人工核对。

## 两个实用特色

|几何辅助线：不只说怎么画|AI设置：一个连接，多个模型|
|:---:|:---:|
|![分步辅助线与原题图对照界面](docs/images/auxiliary-lines.webp)|![AI连接弹窗中的模型、能力与保存按钮](docs/images/ai-connection.webp)|
|逐步看新增点与辅助线，对照原图理解构造。|网站/API地址＋一把Key为一个连接，模型放在连接下。|

- **辅助线与演示**：解题后点击生成分步辅助线方案，AI生成方案，浏览器绘制底图与辅助线，支持圆、弧、扇形边界、下载SVG及按需打开GeoGebra。看图、切步骤、下载不再调用AI。需在原图副本上加线时，可另行启用受支持的Gemini图片编辑模型；原图不覆盖，结果需核对。
- **模型自由搭配**：分别设置识图/补读顺序和解题/问答顺序，文字模型也能负责解题。管理员管理站点连接与模型，选定新账号默认3项（可用项不足3项时全选）并可逐人追加授权；用户可在个人AI设置中添加、编辑或导入自己的连接。站点密钥不返回普通用户。所有角色的AI配置导出默认关闭，只有运维将`SOLVNOTE_ENABLE_AI_CONFIG_EXPORT=true`显式写入部署环境时，管理员加密导出才会恢复。导入、编辑及[无密钥模板](docs/templates/solvnote-ai-config.template.json)保留。
- **过程可见、任务可取回**：显示每一步实际使用的模型、所属连接、是否带图和耗时，不展示内部思维链。后台受理后可离开页面；短任务（含辅助线）可在我的AI任务中用弹窗取回，不必重复付费生成。

## 快速上手

1. **准备AI**：管理员进入`/admin/ai`，手动添加连接和模型，或导入ScanDex的加密配置。按实际能力勾选读图，并把模型加入相应调用顺序，点击保存。连通性测试只验证一次短文字通信，可能收费，不代表已验证识图质量。
2. **提交题目**：从首页或学科错题本添加页上传、裁剪题图，也可只输文字或补充要求。默认先识图再解题；纯文字跳过识图，也保留直接图文解题入口。
3. **核对与追问**：先检查题干、角名和条件；有错可人工修订。看不懂某一步就继续问，也可补充自己的作答。需要几何演示时，手动生成辅助线方案。
4. **整理与保存**：直接修改题目、答案、解析，选择作答状态，填写错误解答、错因和知识点，再保存到错题本。之后按学科整理、练习或打印复习。

**默认图文流程**：视觉模型转录 → 按解题顺序选模型（支持读图就附原图）→ 有疑点先补读 → 真缺条件请你补充 → 完成解析。文字模型会把具体疑问交给视觉模型，多模态解题者可自行核图，不是把所有AI同时调用一遍。

**解题记录与统计**：首页的解题记录入口按受理时间展示会话和旧式直接解题，支持状态筛选、分页与及时刷新；同题追问仍计一条，是否存入错题本另行决定。统计中心分别展示解题、错题收录和复习练习。已完成不等于答对；AI调用只统计当前保留的调用日志，不代表费用或历史总量。现存旧记录保留，已清理的历史任务不能恢复。

**公告管理**：管理员通过`/admin/announcements`管理草稿、发布、暂时隐藏、归档、独立置顶排序和可选有效期，面向所有已登录且启用的账号。用户显式确认已阅后，普通公告进入历史，读后隐藏仅对该用户消失，常驻公告仍保留但不再计入未读。打开列表不自动标已阅，编辑或重新发布不清空已阅状态；需要再次通知所有人时新建公告。列表提供置顶/取消置顶、隐藏/恢复发布快捷操作；永久删除需确认并清除该公告的已阅记录，不能撤销，需保留时用隐藏或归档。正文为纯文本，支持可选英文和站内链接，不发送邮件、浏览器系统或第三方推送。

**公告升级边界**：`2.0.0-yus.2`需要增量迁移`Announcement`和`AnnouncementRead`两张表，并一次性转入原三条内置公告。程序、schema和生成的Prisma客户端必须配套升级，不要原地重新生成运行实例共用的依赖。升级前停止写入并配对备份数据库、配置及原秘密变量。错题本JSON不包含公告和已阅状态，详见[公告管理说明](docs/announcements.md)。

**注册与账户策略（源码已实现；部署实例须单独验收）**：登录、注册都需要Cloudflare Turnstile服务端校验，缺配置或验证失败会拒绝请求。注册开关默认关闭，由管理员在用户管理中显式开启。自注册默认7天，管理员可选7天、30天或永久；后台手动建用户默认永久。账号到期即禁止访问受保护站点和API，到期满30天后由定时任务分批永久清理，保留最后一个管理员恢复账号；已有账号不追溯期限。邀请码默认30天、1次，可续期、停用和调整使用上限；是否在注册框自动显示由独立开关和选定邀请码控制，公开显示意味着不再是私密邀请。重置密码生成仅当次展示的临时密码，并强制改密、吊销旧会话。升级前务必阅读[用户系统部署与验收](docs/user-management.md)，先配置Turnstile再切换应用。

**备份注意**：设置里的错题本JSON导出不含解题会话、AI任务和AI凭据。AI配置导出默认关闭不是完整备份方案；请停止写入，配对保存数据库、配置和原秘密变量（含主钥）。账号永久删除会清理其数据库内学习记录、内嵌图片、AI任务和私有AI配置，不读取或删除导入URL指向的外部文件；备份中的历史数据须单独按保留策略管理。见[部署说明](docs/user-management.md)及[CHANGELOG](CHANGELOG.md)。源码分支实现不代表镜像或演示站已更新。

> **保存边界**：同题会话、直接解题和重新解答长期保留；绘图、举一反三等临时任务结果保留24小时。编辑器里的人工草稿不会因离开页面自动保存，长期保留辅助线也需保存到错题或下载。AI处理会把提交的题图、文字和必要上下文发给你配置的供应商，请勿夹带无关个人信息。

## 部署

**本分支镜像**（支持AMD64/ARM64）：

```text
ghcr.io/yumumao/solvnote:latest
```

### Zeabur：新安装

1. 新建容器服务，使用上面的镜像，服务端口设为`3000`；绑定域名并启用HTTPS。采用**单副本、持续运行**，不要按请求休眠。
2. 添加两个持久卷，名称可自定，**挂载目录必须正确**：

   |建议卷名|挂载目录|保存内容|
   |---|---|---|
   |`solvnote-config`|`/app/config`|配置文件、AI加密主钥|
   |`solvnote-data`|`/app/data`|数据库、账户、错题、AI配置与任务|

3. 在服务的环境变量中逐项添加以下设置。**先替换示例域名、邮箱和尖括号占位符，不要原样部署。**

   ```dotenv
   NEXTAUTH_URL=https://solvnote.n29.net
   NEXTAUTH_SECRET=<替换为新生成的随机值>
   INITIAL_ADMIN_EMAIL=you@example.com
   INITIAL_ADMIN_PASSWORD=<替换为至少12字符的独立口令>
   SOLVNOTE_TURNSTILE_SITE_KEY=<填写本站的site-key>
   SOLVNOTE_TURNSTILE_SECRET_KEY=<填写仅服务端保存的secret-key>
   SOLVNOTE_ENABLE_AI_CONFIG_EXPORT=false
   DATABASE_URL=file:/app/data/dev.db
   ```

   **升级到本用户系统分支前必须配置Turnstile。**在Cloudflare中允许你实际使用的hostname；本地测试需要单独允许`localhost`等实际测试主机。未配置或验证失败会拒绝登录和注册，不提供生产绕过。可选`SOLVNOTE_TURNSTILE_HOSTNAMES`默认从`NEXTAUTH_URL`取hostname。详细流程见[用户系统部署与验收](docs/user-management.md)。

   生成`NEXTAUTH_SECRET`：在装有Node.js的本机终端运行以下命令，把输出填入平台秘密变量，不发给AI或提交Git。也可在有OpenSSL的终端运行`openssl rand -hex 32`。

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. 部署后打开`https://solvnote.n29.net/login`（或你的实际域名），使用上面设置的邮箱与初始口令登录；进入`/admin/ai`配置模型，再用一道不含隐私的题目测试。

`NEXTAUTH_URL`必须与浏览器使用的**协议、主机、端口**一致，不填ScanDex地址、容器地址或`/login`路径。默认无需设置`AI_CONFIG_MASTER_KEY`，主钥会自动保存到`/app/config/ai-master.key`；**不要设置`AI_WORKER_DISABLED=1`或照搬本机代理到Zeabur**。

**多个公开域名**：`NEXTAUTH_URL`只设置一个主站URL，例如`https://solvnote.n29.net`，不要填多个地址或用逗号拼接。其他Zeabur域名建议在Cloudflare或可信反向代理上跳转到主站；当前应用不会自动为公网别名做统一跳转。`SOLVNOTE_TURNSTILE_HOSTNAMES`可以逗号分隔多个精确主机名，但只影响验证码校验，不会放开应用的同源写入限制，也不会共享跨域登录。Cloudflare组件同样要允许实际验证所在的主机名，不填协议、端口或路径。

**已有站点升级**：保留当前`NEXTAUTH_SECRET`、数据库路径、持久卷和AI主钥，不要使用上面新安装示例重新生成它们。本项目统一保留`NEXTAUTH_SECRET`；`AUTH_SECRET`是框架支持的别名，无需额外设置。如果两者都保留，建议保持一致，当前版本优先使用`NEXTAUTH_SECRET`。默认保留`SOLVNOTE_TRUST_PROXY_HEADERS=false`，不能只因接入Cloudflare就开启。

<details>
<summary>自托管：用Docker Compose启动本分支</summary>

新安装请准备Docker与Compose，在一个新目录中建立`.env.solvnote`，填入上面的环境变量。本地试用时把`NEXTAUTH_URL`改为`http://localhost:3000`，浏览器也固定用这个地址；公网使用需另外配置HTTPS反向代理。

在同目录新建`compose.solvnote.yml`，内容如下。仓库提供的`docker-compose.yml`已使用SolvNote镜像；也可以按下方示例另建配置。

```yaml
services:
  solvnote:
    image: ghcr.io/yumumao/solvnote:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env.solvnote
    environment:
      DATABASE_URL: file:/app/data/dev.db
    volumes:
      - ./config:/app/config
      - ./data:/app/data
```

在该目录执行：

```sh
docker compose -f compose.solvnote.yml pull
docker compose -f compose.solvnote.yml up -d
docker compose -f compose.solvnote.yml logs --tail=100
```

打开`http://localhost:3000/login`登录。`.env.solvnote`、`config`、`data`都是私有部署文件，请自行安全备份，不要上传公共仓库。

</details>

### 已有部署：安全升级

1. **先停止应用写入，配对备份`/app/config`和`/app/data`**，记录旧镜像摘要与环境变量；只备份数据库不足以恢复加密内容。
2. 升级到用户系统版本前，先配置并核对上述Turnstile站点与服务端变量；否则登录将被拒绝。在[镜像发布记录](https://github.com/yumumao/solvnote/actions/workflows/build-docker.yml)确认目标版本已发布，再让平台拉取新镜像重新部署。**沿用原卷、原数据库路径、原秘密变量，不重建数据库或更换主钥。**只更新README不需要换镜像。
3. 启动时会自动迁移；已有管理员不会被初始化变量重置。升级后从正式地址登录，检查AI设置、图文解题和任务取回。

回滚时先停应用，再恢复**旧镜像＋两个卷的配对备份＋原环境变量**，不要让旧代码继续写入已升级的数据。详细排障见[部署与构建说明](docs/deployment-build.md)。

## 常见问题

|问题|先这样处理|
|---|---|
|导入提示`IMPORT_ORIGIN_REJECTED`|检查错题本`/admin/ai`中的站点地址诊断，让`NEXTAUTH_URL`匹配浏览器地址；重新部署并重新登录。ScanDex可以是另一地址，重输文件口令不能修复同源问题。|
|启动提示管理员初始化失败|看该提示**之前的第一条错误**。新库需至少12字符的初始口令；旧站先检查`/app/data`挂载与数据库路径，不删卷、不盲目重置账号。|
|模型立即报`AI_ENDPOINT_REJECTED`|云端只接受公共HTTPS接口，检查地址及DNS。不要把本机代理/内网地址当作云端AI地址，也不要关闭安全校验。|
|分析很久，或提示受理状态未知|先到我的AI任务查看阶段与错误；`unknown`不会自动重发，以免重复计费。先核对供应商记录，别连续提交。识图＋解题＋必要补读不等于一次普通聊天，不能保证更快。|
|辅助线没显示或离开后找不到|24小时内到我的AI任务取回短任务，在弹窗内查看；显示问题不要直接重新生成。SVG是重建示意图，不是原图像素叠线，复杂阴影仍以原图为准。|
|想备份或迁移AI设置|本分支默认关闭所有角色的AI导出；迁移请配对备份数据库、配置目录和环境变量，导入可下载无密钥模板。只有运维显式设置`SOLVNOTE_ENABLE_AI_CONFIG_EXPORT=true`才恢复管理员加密导出；站点导入先预览再确认。|

## 技术文档与来源

- [图文解题与补读流程](docs/ai-image-pipeline.md) · [多轮问答、轮数与人工澄清](docs/ai-dialogue-roadmap.md)
- [错题编辑与讲解规则](docs/notebook-editing.md) · [辅助线、图片编辑与任务弹窗](docs/ai-drawing.md)
- [加密AI配置交换格式](docs/portable-ai-config.md) · [部署、构建与排障](docs/deployment-build.md)

技术栈为Next.js、React、TypeScript、Prisma和SQLite；后台任务依赖持续运行的Node进程，不适用于纯无服务器函数或跨主机共享SQLite多副本。部署主线为[`main`](https://github.com/yumumao/solvnote/tree/main)，本仓库暂不提供桌面安装器。

**感谢上游**：[wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook)及原作者、贡献者。本仓库是继续开发版本，本文新增特性不代表上游也有。上游README曾声明MIT，但本次核对的上游与当前快照未发现独立LICENSE文件；本分支不擅自新增许可证或作再授权承诺，再分发或商用前请核实上游许可。

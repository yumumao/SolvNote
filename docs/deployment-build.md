# Docker构建与部署说明

## 目标与已知基线

历史GitHub Actions运行中，`Build and push`步骤耗时921秒。这包含镜像构建、缓存处理和推送，不能当作纯上传耗时。原流程已经使用`gha`缓存，本次不是首次引入缓存。

本次移除双架构构建中的QEMU执行路径及构建阶段不必要的数据库初始化。2026-09-23原生双架构首轮发布约225秒、后续缓存发布约71秒（工作流总耗时），不同缓存条件不能当作稳定提速承诺。此后增加双架构真实容器启动门禁，其额外耗时以对应Actions为准；本机仍无Docker。

## 手动及tag自动发布：共用原生双架构构建

`.github/workflows/build-docker.yml`同时提供`workflow_dispatch`和`workflow_call`。手动发布保留`tag`输入，默认`latest`；`ci.yml`的tag发布通过本地可复用工作流调用同一原生矩阵，不再维护第二套QEMU构建。发布仍同时保留以下两个平台，不预设Zeabur或其他部署主机的架构：

| 目标平台 | 原生runner | 缓存scope |
| --- | --- | --- |
| `linux/amd64` | `ubuntu-24.04` | `wrong-notebook-native-amd64` |
| `linux/arm64` | `ubuntu-24.04-arm` | `wrong-notebook-native-arm64` |

流程：

1. 验证镜像标签，将仓库路径转为小写；统一生成并校验完整标签集及OCI元数据。
2. 两个runner分别安装其目标架构依赖、生成Prisma客户端并构建镜像，先推送不可变digest，不单独覆盖公开标签。
3. 每个原生runner拉取自己的digest，以无外部网络的临时合成卷运行`scripts/smoke-container.sh`：验证新库管理员初始化、HTTP启动、双卷复用且不修改已有管理员、缺初始密码时安全退出。全部通过才导出供合并的digest。
4. 两个构建及启动检查均成功后，先dry-run合并两个digest并确认包含amd64和arm64，再将同一个双架构manifest发布到全部目标标签，逐标签复核平台。
5. 任一架构构建或启动检查失败时，合并任务不运行。不能把单架构构建成功误报成双架构发布完成。

`gha`使用独立架构scope和v2后端，避免两个构建互相覆盖缓存。切换scope后的首次运行可能是冷缓存。Dockerfile的npm/Next缓存挂载用于可复用的BuildKit环境；普通`gha`层缓存不等于这些可变缓存挂载已跨runner持久化，不能据此宣称Next增量缓存必然命中。

如果仓库策略或runner配额不允许ARM runner，应配置真正的原生ARM64自托管runner并修改对应label；不要静默删除ARM64构建。工作流中没有QEMU兜底，ARM runner不可用时必须显式解决。

### 工作流范围

- 手动发布只写指定Docker标签。选择预发行Git tag手动运行时，不能将其发布为`latest`。
- `ci.yml`的`v*`tag调用`build-docker.yml`并传入`release_tags: true`。稳定版`v1.2.3`发布`1.2.3`、`1.2`、`1`、`latest`和`sha-<7位提交SHA>`；预发行`v1.2.3-rc.1`只发布`1.2.3-rc.1`和SHA标签，不更新major/minor/latest。保留`v0.x.y`的`0`主版本标签；无效semver在构建前失败。
- 两个入口在可复用工作流内共用仓库级发布锁，`cancel-in-progress: false`、`queue: max`；调用方不重复加同组锁，避免自阻塞或自取消。每次发布内部仍双架构并行，不同发布串行，防止同一major/minor/latest被两个运行交错改写。排队上限100；排队次序不等于语义版本排序，后续手动发布或旧版本tag仍可能覆盖可变别名，应按发布顺序操作。
- 调用方显式授予`contents: read`及`packages: write`；被调用方只有镜像构建/manifest任务需要包写权限，prepare保持只读，不传递额外secret。Checkout不持久化Git凭据。
- Digest artifact同时限定run ID和attempt，拒绝混用重试前产物。失败后请选择重新运行所有任务，而非只重跑失败job。多标签推送不是仓库事务；网络故障仍可能使部分别名未更新，但不会因某架构构建失败而发布单架构标签。
- CI兼容上游`main`及当前派生仓库的`main-yus`，PR目标分支也相同。
- Release的版本回写不再硬编码`main`，只允许标签提交恰好位于仓库默认分支当前tip时回写；旧标签、其他分支上的标签不会被推入默认分支。正常的非强制push仍会阻止并发历史覆盖。

## Dockerfile边界

所有阶段默认使用目标平台。不要改成在`BUILDPLATFORM`安装依赖，再把整个`node_modules`拷入另一架构镜像；SQLite等原生依赖不能如此跨架构复用。

保留的构建工作：

- 按锁文件执行`npm ci`，依赖层只依赖包清单。
- 安装OpenSSL后，在目标平台运行`prisma generate`；`native`会为该平台解析Prisma引擎。ARM镜像不能依赖仅为x64生成的客户端。
- 编译运行时标签初始化脚本并复制其产物。
- `AI_WORKER_DISABLED=1 npm run build`：禁用开关仅作用于这条构建命令，不设置为运行时`ENV`。镜像启动后的worker不能被意外永久关闭。

移除的构建工作：

- `prisma migrate deploy`、数据库seed及标签重建执行。
- 打包开发SQLite数据库、复制本地`config`目录。

构建仍需要Prisma类型和客户端，但静态页面不依赖预填数据库。运行镜像显式携带schema、全部migration、Prisma CLI/同平台引擎、管理员seed脚本与编译后的标签脚本。若今后增加构建时查询数据库的静态页面，应重新评估数据来源，而不是恢复打包生产数据或在构建时启动队列worker。

构建上下文仍必须由`.dockerignore`排除私有配置、数据库、备份、日志和本机`node_modules`。运行镜像不复制它们并不代表允许它们进入构建上下文或缓存。

## 持久卷与首次启动

两个原有持久挂载都必须保留：

- `/app/data`：SQLite数据库、初始化/版本标记，以及新增AI配置和任务表所在的数据库。
- `/app/config`：现有配置及AI主密钥。加密数据库与主密钥是配对资产；仅保留数据库、丢失主密钥可能无法解密已有AI配置。

升级前对两个卷做一致性备份；不要用空目录覆盖旧卷，不要将本机配置放进镜像。这里没有重置数据库、重建卷或修改生产数据的步骤。

入口脚本按顺序执行：

1. 确保两个目录存在并调整应用用户权限。
2. 以`nextjs`用户执行所有待处理迁移，包括新AI表迁移；新数据库由迁移创建，不再复制构建时预置数据库。
3. 每次启动检查管理员初始化：已有管理员不重置密码、不提权、不修改启用状态；没有管理员时必须通过运行时环境提供至少12字符的`INITIAL_ADMIN_PASSWORD`，缺失或过短会失败退出，不提供默认密码。
4. 新数据库或应用版本变化时重建系统标签。数据库丢失但版本标记仍存在，也必须重建。
5. 必要初始化全部成功后记录标记，再启动主应用；应用的instrumentation负责启动worker。

**迁移失败必须退出，不能把错误解释为没有待处理迁移。**管理员或标签初始化失败也会退出；失败时不提前推进版本标记，修复原因后重启可重试。相比旧版本的吞错继续启动，这可能暴露已有数据库、权限或初始化问题，这是故意的失败关闭行为，不应通过`|| true`掩盖。

## CI构建与E2E凭据

CI的build-check及E2E构建步骤均仅在`npm run build`这一步设置`AI_WORKER_DISABLED=1`，不在job全局或服务运行期关闭worker。

E2E使用一次性`e2e.db`。该job显式配置仅供CI测试的合成`INITIAL_ADMIN_PASSWORD`，长度至少12；`npx prisma db seed`与三个E2E管理员登录测试读取同一个环境值。测试没有弱密码fallback，缺失或过短会在收集测试时明确失败。此合成值不是生产凭据，不得照搬部署；本地E2E也应只针对隔离测试库设置自己的合成值。

CI的seed入口为`prisma/seed.ts`，容器入口为`scripts/seed-admin.js`，两者均已适配上述安全初始化契约。`upload-correction.spec.ts`的分析mock已改为202提交与任务轮询；静态检查或测试收集不等于整套Playwright E2E、真实供应商调用或容器部署已通过。

## 发布前验证清单

本地完成的是提示词回归测试、隔离shell分支执行和YAML/脚本静态检查。shell检查使用假外部命令与临时路径，不等于真实SQLite、容器权限或Prisma引擎验证。

有Docker的环境仍须逐架构验证：

- 构建成功，运行镜像没有构建时的`AI_WORKER_DISABLED=1`。
- 全新两个临时卷能迁移、初始化管理员/标签、启动服务和worker。
- 使用经过脱敏的测试备份验证现有卷升级，数据库与主密钥保持可用。
- 人为制造测试库迁移失败时容器非零退出，HTTP服务和worker均不启动。
- 验证ARM上的Prisma/OpenSSL及其他原生依赖实际可加载。
- 检查发布manifest确含两个平台，并分别拉取冒烟测试。
- 在部署域名验证登录、退出及非管理员访问管理页的重定向，确认不会跳到容器内部主机名或改变预期origin；配置API须独立保持401/403，不能只依赖页面跳转保护。
- 分别记录冷/暖缓存的两架构构建时长、manifest合并时间和整个工作流墙钟时间，再与921秒旧步骤做同口径比较；并行任务时长相加不等于用户等待时长。

不要在生产卷上制造迁移故障或试验恢复。

## AI导入与本站地址

ScanDex负责导出文件，错题本页面负责将文件提交给错题本后台。文件导入不要求两个项目同址，不需要为ScanDex添加CORS白名单。

- Zeabur运行时的`NEXTAUTH_URL`必须填写浏览器实际使用的错题本HTTPS地址，不是ScanDex地址，也不是容器内部地址。更换站点域名后需更新环境并重启相应错题本实例，重新登录。
- 页面认证跳转与AI写入校验共享同一规范地址；不信任任意Forwarded或Host作为写入许可。
- 本地使用HTTP回环地址时，GET页面访问`localhost`/`127.0.0.1`的另一个别名会跳回明确配置的本站地址，不接受跨源POST，不改写生产反向代理的内部Host。
- `next.config.ts`的`skipProxyUrlNormalize: true`用于保留规范跳转地址；Next16会在middleware响应适配阶段将`127.0.0.1`重写为`localhost`，仅修正业务代码里的Location不足以避免此问题。改变该开关后必须重新构建，并做真实浏览器登录/导入/普通用户跳转回归；单元测试无法覆盖框架响应适配阶段。

本地别名纠正使用不缓存的Refresh导航页（目标固定为显式规范地址，链接进行HTML转义）。原因是Next后续路由层还会把Location按监听主机改成相对路径，直接307会在别名地址形成循环。此导航仅处理HTTP回环GET页面，不处理API或跨源POST。


## 管理员初始化阶段退出的排查

`Admin initialization failed; refusing to start the application`是启动脚本的汇总消息，`BackOff`是容器退出后的反复重启，不是镜像仍在构建。请查看该消息之前的第一条错误，不要通过删除卷、重置管理员或跳过初始化掩盖故障。

- 若前面是`MODULE_NOT_FOUND`且指向`bcryptjs/umd/index.js`：这是曾发现的精简镜像遗漏CommonJS入口问题。当前Dockerfile显式携带完整bcryptjs，并在构建期只加载seed模块验证依赖；发布前再运行真实容器检查。升级到包含此修复的新镜像，无需修改已有管理员密码。
- 若前面明确提示`INITIAL_ADMIN_PASSWORD`：仅当目标数据库没有任何管理员时才要求设置至少12字符的非空初始密码；已存在管理员（包括停用的管理员）应保持不变。旧站突然触发首次初始化时先检查实际镜像、`DATABASE_URL`和`/app/data`挂载，不要在错误的新库里盲目创建新管理员。
- 确认Zeabur镜像来源是`ghcr.io/yumumao/wrong-notebook-yus`及对应发布digest。日志中的容器显示名可能沿用创建服务时的旧名称，不能仅凭显示名认定当前仍在使用上游镜像。
- `scripts/smoke-container.sh`只供隔离CI/显式本地Docker验收，自动新建并清理自己的合成容器和卷；绝不指向真实卷。管理员和会话测试值随机生成到临时env文件，不写日志或镜像，两个持久卷及数据库不会放进公开artifact。

## 导入或导出被同源校验拒绝

`IMPORT_ORIGIN_REJECTED`不代表ScanDex口令错误，也不是两个项目必须同域名。校验在错题本读取导入文件之前发生；给错题本增加导出功能不会绕过此保护。

1. 管理员打开`/admin/ai`的站点地址检查，核对浏览器页面地址与后台NEXTAUTH_URL。
2. 确认浏览器使用的是错题本正式域名，再在Zeabur环境变量中设置`NEXTAUTH_URL=https://你的错题本正式域名`。只用协议、主机和必要端口；不要填ScanDex地址、API供应商地址、容器内部地址或口令。localhost与127.0.0.1是两个不同origin。
3. 保留`wrong-notebook-config → /app/config`及`wrong-notebook-data → /app/data`，重新部署使环境变量生效；从正式地址重新登录，再预览导入。
4. 地址一致仍报错时，核对浏览器Network中失败请求的Origin与Sec-Fetch-Site及代理是否改写它们。不要发送Cookie、Authorization、Key、口令或导入文件来排错。不要关闭同源校验，也不要用未经验证的X-Forwarded-Host任意放行。

诊断接口仅管理员可读；旧镜像没有该接口时页面会提示暂不可用，需要部署新后台。登录成功本身不能证明受保护的AI写入接口地址配置正确。修改本地源码或发布镜像也不等于已修改Zeabur环境变量。

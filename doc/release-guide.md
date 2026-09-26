# 解迹·SolvNote 版本发布指南

本文档说明如何为解迹·SolvNote准备版本、发布Git标签和构建Docker镜像。当前源码保留上游`wttwins/wrong-notebook`的致谢与兼容边界；这里的发布对象是本仓库自己的SolvNote代码，不是上游项目。

## 发布前提

- 先在本地完成定向测试、TypeScript检查、生产构建和`git diff --check`。
- 本地目录名为`solvnote`，代码包名为`solvnote`；版本号以`package.json`为准。
- GitHub仓库重命名后，确认`origin`已指向`https://github.com/yumumao/solvnote.git`再推送。本地改名本身不会自动修改远程仓库，也不会发布镜像。
- 涉及Prisma迁移时，先停止目标实例写入并配对备份数据库、配置目录和原秘密变量，尤其是AI加密主钥。
- 只有明确确认镜像构建成功后，才让部署平台拉取新摘要；不要用`latest`替代迁移前的版本核对。

## 版本标签策略

项目使用语义化版本，格式为`v主版本.次版本.补丁版本`。历史`2.0.0-yus.*`记录保持不改；新SolvNote版本从下一次正式发布开始按语义化版本递增。

|版本类型|示例|说明|
|---|---|---|
|主版本|`v3.0.0`|不兼容的API或数据行为变更|
|次版本|`v2.1.0`|新增向下兼容功能|
|补丁版本|`v2.0.1`|向下兼容的修复或文档更新|

## 发布操作流程

### 1. 确认工作树与测试结果

```bash
git status --short
git diff --check
npm run test:run
npm run typecheck
npm run build
```

实际脚本名称以`package.json`为准；如果发布包含数据库迁移，还要在隔离数据库执行迁移和回滚前检查。

### 2. 提交并推送发布分支

```bash
git add .
git commit -m "release: SolvNote vX.Y.Z"
git push origin main
```

推送前再次核对remote、分支和提交内容；不要把真实数据库、配置、密钥、题目或测试导出文件加入提交。

### 3. 创建并推送标签

```bash
git tag -a vX.Y.Z -m "SolvNote vX.Y.Z"
git push origin vX.Y.Z
```

GitHub Actions会按工作流配置构建并发布`ghcr.io/yumumao/solvnote`。在Actions与Packages中同时核对提交、架构、镜像摘要和标签，不把仅有源码标签说成镜像已发布。

## 镜像标签

|标签|用途|
|---|---|
|`X.Y.Z`|精确版本，生产部署优先|
|`X.Y`|同一小版本的补丁别名|
|`X`|同一主版本的最新补丁别名|
|`latest`|最新稳定版本，测试和生产升级都需先核对摘要|
|`sha-xxxxxxx`|提交可追溯标签|

## 用户部署方式

```yaml
services:
  solvnote:
    image: ghcr.io/yumumao/solvnote:X.Y.Z
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env.solvnote
    volumes:
      - ./config:/app/config
      - ./data:/app/data
```

升级时保留原卷、数据库路径、`NEXTAUTH_SECRET`、AI配置主钥和其他秘密变量；迁移完成前不要启动旧代码继续写入新结构。回滚也必须使用与数据库结构匹配的旧镜像和配对备份。

## 上游边界

上游项目地址仍为`https://github.com/wttwins/wrong-notebook`。上游镜像与历史兼容说明不属于SolvNote发布产物；Compose示例应使用本仓库的`ghcr.io/yumumao/solvnote`镜像。

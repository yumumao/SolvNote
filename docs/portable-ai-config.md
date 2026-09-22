# portable-ai-config v1

此文档定义ScanDex与错题本已实现的AI设置交换格式。desktop-search、ImgToDoc是后续消费者，不应直接读另一个应用的数据库或主钥。

## 加密信封

```json
{
  "format": "portable-ai-config",
  "v": 1,
  "alg": "AES-256-GCM",
  "kdf": "PBKDF2-SHA256",
  "iter": 300000,
  "salt": "<base64:16 bytes>",
  "iv": "<base64:12 bytes>",
  "data": "<base64:ciphertext followed by 16-byte authentication tag>"
}
```

口令用UTF-8编码，不自动trim；12～1024字符。PBKDF2输出32字节，AES-GCM无AAD。每次导出重新生成salt与iv。文件上限1MiB。消费者必须拒绝未知版本、不同KDF/算法、不合法编码、异常迭代次数和认证失败，不尝试不受约束的KDF参数。

ScanDex在已认证管理员浏览器中加密，独立导出口令不发送服务器；下载结果不包含明文凭据。错题本在服务端解密、校验与保存，接口不回显API密钥。

## 明文白名单

```ts
interface PortableAIConfig {
  version: 1;
  providers: Array<{
    id: string;
    name: string;
    protocol: 'chat' | 'responses' | 'responses_codex' | 'gemini' | 'azure';
    baseUrl: string;
    apiKey: string;
    enabled: boolean;
    apiVersion?: string; // Azure固定日期版本
  }>;
  models: Array<{
    id: string;
    providerId: string;
    name: string;
    model: string;
    capabilities: Array<'text' | 'vision'>;
    enabled: boolean;
  }>;
  chains: { text: string[]; vision: string[] };
}
```

- provider ID最长80字符，model ID最长160字符，字符集`A-Za-z0-9_.:@/-`；引用必须存在、唯一且能力匹配。
- provider显示名称最多100字符；model显示名称与实际模型名均最多200字符。
- 最多50个provider、200个model，每条链最多30项。停用项可以保留，但不能出现在启用链中。
- 地址为HTTPS，不能有userinfo、查询参数或fragment。Azure版本通过独立字段指定。完整Chat/Responses端点会按协议规范化；自定义路径前缀不会额外插入`/v1`。
- 不导出代理、磁盘路径、图库/健康内容、消费者桥接token、账户、任意header、温度、token上限、并发或任务预算。后者由消费者自己实施，避免导入文件改变站点安全边界。
- ScanDex当前真实映射输出Chat、Responses或Codex Responses，不虚构源配置不存在的Gemini/Azure字段。自定义文字/视觉端点分别映射；源模型名保持不变，稳定ID由源标识和模型名散列生成。

## 导入语义

1. 实时数据库管理员鉴权，同源请求，限制文件和请求体体积。
2. 解密、校验白名单与引用；不执行文件中的URL或脚本。
3. 合并或替换预览，只返回脱敏内容，不创建AI配置行，也不覆写旧JSON。全新安装首次预览可能生成持久主钥，用于绑定确认令牌；已有主钥缺失或损坏时不会静默替换。非法确认请求不会创建配置行或主钥。
4. 确认令牌绑定管理员、预览内容、配置版本和5分钟有效期。
5. 确认时再次验证、解密与CAS保存；版本变化需重新预览，失败不部分写入。

合并：同ID以导入配置为准；导入链排在前面，追加当前链的其余有效项并去重。替换：仅替换全部AI连接与模型链。两种操作都不改变其他业务配置。

## 已保存配置去重（与导入合并分开）

管理员在`/admin/ai`保存编辑后，可使用检测与合并入口。它不改变v1交换格式，也不要求ScanDex或其他消费者同步升级。

- `POST /api/ai/config/deduplicate`先preview再apply，同源、管理员鉴权、严格请求字段和64KiB体积上限；没有已保存配置时要求先保存，不触发迁移或创建主钥。
- 在服务端比较解密后的非空真实Key。响应仅返回脱敏配置和连接ID等价分组，不返回凭据或稳定Key指纹；空值、空白和掩码不作为相同证据。
- 地址仅规范化主机大小写、默认端口和末尾斜杠，不猜测不同路径或不同协议等价；API版本也须一致。真实Key精确比较，不trim；实际模型/部署名区分大小写。
- 先合并连接并迁移模型归属，再按连接内实际模型名分组。没有冲突时默认保留最先登记项，也可选另一项或保留分开；启用状态/能力冲突默认分开，显式选择才改变保留项，不自动取能力并集。
- 原有两类任务链分别映射ID并稳定去重，保留首次出现位置，不自动扩大任务成员。保留停用或能力较少的模型可能移除不合格链成员，管理员须在预览中核对。
- 修改选择必须重新预览；改连接选择时旧模型分组选择作废。预览令牌用带操作域的HMAC绑定管理员、原始配置、选择、版本、随机nonce和5分钟有效期。apply只使用服务端重算结果，经原子CAS保存；过期、并发修改、跨用户和成功后的重放均拒绝。
- 所有响应no-store。预览只读且不调用上游AI；错误不返回原始异常。应用遇到网络错误时不自动重试，先刷新核对保存状态。

## 存储与后续软件边界

交换口令不等于数据库主钥，各应用单独保存自己的凭据。云端错题本主钥在`/app/config`，SQLite在`/app/data`，迁移/恢复必须成对备份。

未来可安装软件应分离：模块业务逻辑、平台凭据存储、服务生命周期、可选依赖安装、端口/健康检查。公共接口与配置格式不硬编码本机路径和代理；云端不得直接调用安装在用户电脑上的特权服务。

后续消费者适配须保留原有空链/缺失链语义、文字/视觉能力及顺序，不把`responses_codex`退化为Chat。先完成合成跨语言夹具测试，再做用户授权的真实接口验证。

## 导入诊断与消费者限制

v1信封未因UI两层设置或重复合并而改变。ScanDex的本地导出器允许HTTP或带query的端点；云端消费者仍拒绝这些配置，包括停用条目，不改写URL、不自动跳过、不部分保存。当前ScanDex映射器与WebCrypto导出函数的合成跨语言夹具覆盖长模型名及停用HTTP/query连接；前者兼容，后者返回明确策略诊断。

解密认证失败仅返回`INVALID_EXPORT_OR_PASSPHRASE`；通过认证但JSON损坏返回`INVALID_EXPORT_PAYLOAD`；通过认证但schema不符返回`IMPORT_CONFIG_INCOMPATIBLE`及至多16个固定字段路径/原因。原因只有`URL_POLICY`、`FIELD_CONSTRAINT`、`REFERENCES_OR_CHAINS`，数组下标从0开始；不返回原始校验异常或字段值。未知错误只按阶段分类，不输出堆栈、主钥、供应商地址或Key。合并后超限单独返回`IMPORT_MERGE_INCOMPATIBLE`，不建议为绕过错误盲目替换。

身份、同源、主钥、持久存储和预览冲突各自分类；导入响应均`no-store`。确认阶段断网/超时不能据此承诺未写入，须刷新核对状态；仍使用原有原子CAS，禁止自动重试。

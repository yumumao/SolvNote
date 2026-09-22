/**
 * 应用配置模块单元测试
 * 测试 getAppConfig 和 updateAppConfig 函数
 * 注意：这些测试 mock 了文件系统操作
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Never read real configuration or send fixture contents to the application logger.
vi.mock('fs', () => {
    const filesystem = {
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
    };
    return { default: filesystem, ...filesystem };
});

const loggerMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ createLogger: () => loggerMock }));

const configEnvKeys = [
    'AI_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL',
    'GOOGLE_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_MODEL',
    'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT',
    'AZURE_OPENAI_API_VERSION', 'AZURE_OPENAI_MODEL',
] as const;

const legacyConfig = {
    aiProvider: 'openai',
    allowRegistration: false,
    openai: {
        apiKey: ['synthetic', 'legacy', 'credential'].join('-'),
        baseUrl: 'https://legacy.example.test/v1',
        model: 'synthetic-model',
    },
    prompts: { analyze: 'synthetic prompt' },
    timeouts: { analyze: 90000 },
};

describe('config module', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Each import sees only synthetic configuration, never host AI credentials.
        for (const key of configEnvKeys) vi.stubEnv(key, undefined);
        // Clear module cache to re-import with fresh state
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('getAppConfig', () => {
        it('应该返回默认配置（文件不存在时）', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const { getAppConfig } = await import('@/lib/config');
            const config = getAppConfig();

            expect(config.aiProvider).toBe('gemini'); // 默认值
            expect(config.allowRegistration).toBe(true);
        });

        it('应该从环境变量读取 AI Provider', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            process.env.AI_PROVIDER = 'openai';

            const { getAppConfig } = await import('@/lib/config');
            const config = getAppConfig();

            expect(config.aiProvider).toBe('openai');
        });

        it('应该从环境变量读取 API Keys', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            process.env.OPENAI_API_KEY = 'sk-env-key';
            process.env.GOOGLE_API_KEY = 'AIza-env-key';

            const { getAppConfig } = await import('@/lib/config');
            const config = getAppConfig();

            // OpenAI 现在使用多实例格式
            expect(config.openai?.instances?.[0]?.apiKey).toBe('sk-env-key');
            expect(config.gemini?.apiKey).toBe('AIza-env-key');
        });

        it('应该从配置文件读取并与默认值合并', async () => {
            // 新格式的配置文件
            const fileConfig = {
                aiProvider: 'openai',
                openai: {
                    instances: [{
                        id: 'test-instance',
                        name: 'Test',
                        apiKey: 'sk-file-key',
                        baseUrl: 'https://api.openai.com/v1',
                        model: 'gpt-4o',
                    }],
                    activeInstanceId: 'test-instance',
                },
            };
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(fileConfig));

            const { getAppConfig } = await import('@/lib/config');
            const config = getAppConfig();

            expect(config.aiProvider).toBe('openai');
            expect(config.openai?.instances?.[0]?.apiKey).toBe('sk-file-key');
            // 其他默认值应该保留
            expect(config.allowRegistration).toBe(true);
            expect(config.gemini).toBeDefined();
        });

        it('应该在配置文件解析失败时返回默认值', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify(legacyConfig).slice(0, -1)
            );

            const { getAppConfig } = await import('@/lib/config');
            const config = getAppConfig();

            // Parsing errors can contain source snippets: log only a fixed message.
            expect(config.aiProvider).toBe('gemini');
            expect(loggerMock.error.mock.calls).toEqual([['Failed to read config file']]);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });

        it('应该使用环境变量的模型名称', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            process.env.OPENAI_API_KEY = 'sk-test';
            process.env.OPENAI_MODEL = 'gpt-4-turbo';
            process.env.GEMINI_MODEL = 'gemini-3.0';

            const { getAppConfig } = await import('@/lib/config');
            const config = getAppConfig();

            expect(config.openai?.instances?.[0]?.model).toBe('gpt-4-turbo');
            expect(config.gemini?.model).toBe('gemini-3.0');
        });

        it('应该使用默认模型名称（无环境变量时）', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            process.env.OPENAI_API_KEY = 'sk-test';
            delete process.env.OPENAI_MODEL;
            delete process.env.GEMINI_MODEL;

            const { getAppConfig } = await import('@/lib/config');
            const config = getAppConfig();

            expect(config.openai?.instances?.[0]?.model).toBe('gpt-4o');
            expect(config.gemini?.model).toBe('gemini-2.5-flash');
        });
    });

    describe('legacy read safety', () => {
        it('应该仅在内存迁移旧版 flat 配置并保留其他字段', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyConfig));

            const { getAppConfig } = await import('@/lib/config');
            const config = getAppConfig();
            const instance = config.openai?.instances?.[0];

            expect(config.openai?.instances).toHaveLength(1);
            expect(instance).toEqual({ ...legacyConfig.openai, id: expect.any(String), name: 'Default' });
            expect(instance?.id).not.toBe('');
            expect(config.openai?.activeInstanceId).toBe(instance?.id);
            expect(config).toMatchObject({
                aiProvider: 'openai',
                allowRegistration: false,
                prompts: legacyConfig.prompts,
                timeouts: legacyConfig.timeouts,
            });
            expect(config.gemini).toBeDefined();
            expect(fs.writeFileSync).not.toHaveBeenCalled();
            expect(fs.mkdirSync).not.toHaveBeenCalled();
            expect(loggerMock.error).not.toHaveBeenCalled();
        });

        it('重复读取旧 JSON 不应修改模拟磁盘中的原文件', async () => {
            const originalJson = JSON.stringify(legacyConfig);
            let storedJson = originalJson;
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockImplementation(() => storedJson);
            vi.mocked(fs.writeFileSync).mockImplementation((_file, content) => {
                storedJson = String(content);
            });

            const { getAppConfig } = await import('@/lib/config');
            for (let attempt = 0; attempt < 2; attempt++) {
                const config = getAppConfig();
                expect(config.openai?.instances).toHaveLength(1);
                expect(config.openai?.activeInstanceId).toBe(config.openai?.instances?.[0]?.id);
            }

            expect(storedJson).toBe(originalJson);
            expect(fs.readFileSync).toHaveBeenCalledTimes(2);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });

        it('只读文件系统仍应返回内存迁移结果而非回退默认值', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyConfig));
            vi.mocked(fs.writeFileSync).mockImplementation(() => {
                throw new Error('Synthetic read-only filesystem');
            });

            const { getAppConfig } = await import('@/lib/config');
            const config = getAppConfig();

            expect(config.aiProvider).toBe('openai');
            expect(config.openai?.instances?.[0]).toMatchObject(legacyConfig.openai);
            expect(loggerMock.error).not.toHaveBeenCalled();
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        it('无凭据的旧格式应保留空配置且不写盘', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ openai: { apiKey: '' } }));

            const { getAppConfig } = await import('@/lib/config');

            expect(getAppConfig().openai).toEqual({ instances: [], activeInstanceId: undefined });
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        it('内存迁移仍应补齐旧配置的默认 URL 和模型', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
                openai: { apiKey: legacyConfig.openai.apiKey },
            }));

            const { getAppConfig } = await import('@/lib/config');

            expect(getAppConfig().openai?.instances?.[0]).toMatchObject({
                apiKey: legacyConfig.openai.apiKey,
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-4o',
            });
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        it('读取旧格式的激活实例也不应写盘', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyConfig));

            const { getActiveOpenAIConfig } = await import('@/lib/config');

            expect(getActiveOpenAIConfig()).toMatchObject(legacyConfig.openai);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        it('读取异常应回退默认值且日志不含原始异常或内容', async () => {
            const readError = new Error(JSON.stringify(legacyConfig));
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockImplementation(() => { throw readError; });

            const { getAppConfig } = await import('@/lib/config');

            expect(getAppConfig().aiProvider).toBe('gemini');
            expect(loggerMock.error.mock.calls).toEqual([['Failed to read config file']]);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });
    });

    describe('updateAppConfig', () => {
        it('显式更新旧格式应只写一次并保存内存迁移及合并结果', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(legacyConfig));

            const { updateAppConfig } = await import('@/lib/config');
            const result = updateAppConfig({ prompts: { similar: 'synthetic update' } });

            expect(result.openai?.instances?.[0]).toMatchObject(legacyConfig.openai);
            expect(result.openai?.activeInstanceId).toBe(result.openai?.instances?.[0]?.id);
            expect(result.allowRegistration).toBe(false);
            expect(result.prompts).toEqual({ ...legacyConfig.prompts, similar: 'synthetic update' });
            expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                path.join(process.cwd(), 'config', 'app-config.json'),
                JSON.stringify(result, null, 2)
            );
        });
        it('应该成功写入配置文件', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(fs.writeFileSync).mockImplementation(() => { });

            const { updateAppConfig } = await import('@/lib/config');
            const result = updateAppConfig({ aiProvider: 'openai' });

            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(result.aiProvider).toBe('openai');
        });

        it('应该合并嵌套配置', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(fs.writeFileSync).mockImplementation(() => { });

            const { updateAppConfig } = await import('@/lib/config');
            const result = updateAppConfig({
                openai: {
                    instances: [{
                        id: 'new-instance',
                        name: 'New',
                        apiKey: 'new-key',
                        baseUrl: 'https://api.openai.com/v1',
                        model: 'gpt-4o',
                    }],
                    activeInstanceId: 'new-instance',
                },
            });

            expect(result.openai?.instances?.[0]?.apiKey).toBe('new-key');
            // 实例应该存在
            expect(result.openai?.instances?.length).toBeGreaterThan(0);
        });

        it('应该在写入失败时抛出错误', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            const writeError = new Error(JSON.stringify(legacyConfig));
            vi.mocked(fs.writeFileSync).mockImplementation(() => { throw writeError; });

            const { updateAppConfig } = await import('@/lib/config');
            let caught: unknown;
            try {
                updateAppConfig({ aiProvider: 'openai' });
            } catch (error) {
                caught = error;
            }

            expect(caught).toBe(writeError);
            expect(loggerMock.error.mock.calls).toEqual([['Failed to write config file']]);
        });

        it('应该更新提示词配置', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(fs.writeFileSync).mockImplementation(() => { });

            const { updateAppConfig } = await import('@/lib/config');
            const result = updateAppConfig({
                prompts: { analyze: '自定义提示词' },
            });

            expect(result.prompts?.analyze).toBe('自定义提示词');
        });

        it('应该更新注册开关', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(fs.writeFileSync).mockImplementation(() => { });

            const { updateAppConfig } = await import('@/lib/config');
            const result = updateAppConfig({ allowRegistration: false });

            expect(result.allowRegistration).toBe(false);
        });
    });
});

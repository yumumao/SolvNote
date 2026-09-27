import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from './session-fixture';

test('Admin saves two-layer connections, models and capabilities without exposing keys', async ({ page, baseURL, signInAs }) => {
    test.setTimeout(120000);
    // Only exercise our own app. Saving configuration must not contact a provider.
    const externalRequests: string[] = [];
    await page.route('**/*', async route => {
        if (new URL(route.request().url()).origin !== new URL(baseURL!).origin) {
            externalRequests.push('blocked');
            return route.abort();
        }
        return route.continue();
    });

    await signInAs();
    await page.goto('/');

    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('tab', { name: /AI Provider|AI 提供商/ }).click();
    await page.getByRole('link', { name: '管理站点AI配置、模型顺序与导入' }).click();
    await expect(page.getByRole('heading', { name: 'AI设置', exact: true })).toBeVisible();
    await expect(page.getByLabel('AI设置保存栏', { exact: true }).getByRole('status')).toContainText('配置仅管理员可见');

    const suffix = randomUUID();
    const firstName = `E2E connection ${suffix}`;
    const secondName = `E2E alternate ${suffix}`;
    const endpoint = 'https://example.com/v1';
    await page.getByRole('button', { name: '＋添加连接', exact: true }).click();
    const first = page.getByRole('dialog');
    await expect(first).toBeVisible();
    await expect(first.locator('details')).toHaveCount(0);
    await first.getByLabel('连接名称', { exact: true }).fill(firstName);
    await first.getByLabel('API基础地址', { exact: true }).fill(endpoint);
    await first.getByLabel('API密钥', { exact: true }).fill(`synthetic-${randomUUID()}`);
    await first.getByRole('button', { name: '＋添加模型', exact: true }).click();
    await first.getByLabel('显示名称', { exact: true }).fill('E2E text');
    await first.getByLabel('上游模型/部署名', { exact: true }).fill('synthetic-text');
    await first.getByRole('button', { name: '＋添加模型', exact: true }).click();
    await first.getByLabel('显示名称', { exact: true }).nth(1).fill('E2E vision');
    await first.getByLabel('上游模型/部署名', { exact: true }).nth(1).fill('synthetic-vision');
    await first.getByLabel('支持读图（多模态）', { exact: true }).nth(1).check();

    await first.getByRole('button', { name: '同地址添加另一把Key', exact: true }).click();
    const second = page.getByRole('dialog');
    await second.getByLabel('连接名称', { exact: true }).fill(secondName);
    await expect(second.getByLabel('API基础地址', { exact: true })).toHaveValue(endpoint);
    await expect(second.getByLabel('API密钥', { exact: true })).toBeEmpty();
    await second.getByLabel('API密钥', { exact: true }).fill(`synthetic-${randomUUID()}`);
    await second.getByRole('button', { name: '＋添加模型', exact: true }).click();
    await second.getByLabel('显示名称', { exact: true }).fill('E2E alternate text');
    await second.getByLabel('上游模型/部署名', { exact: true }).fill('synthetic-text');

    await second.getByRole('button', { name: '关闭（保留草稿）', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Models are opt-in to independent solving and transcription orders.
    const textOrder = page.getByLabel('添加text链模型', { exact: true });
    const visionOrder = page.getByLabel('添加vision链模型', { exact: true });
    await expect(visionOrder.getByRole('option', { name: `E2E text · ${firstName}`, exact: true })).toHaveCount(0);
    await textOrder.selectOption({ label: `E2E text · ${firstName}` });
    await textOrder.selectOption({ label: `E2E vision · ${firstName}` });
    await textOrder.selectOption({ label: `E2E alternate text · ${secondName}` });
    await visionOrder.selectOption({ label: `E2E vision · ${firstName}` });
    const saveBar = page.getByLabel('AI设置保存栏', { exact: true });
    expect(await saveBar.evaluate(el => getComputedStyle(el).position)).toBe('fixed');
    const saving = page.waitForResponse(r => r.url().endsWith('/api/ai/config') && r.request().method() === 'POST');
    await saveBar.getByRole('button', { name: '保存设置', exact: true }).click();
    expect((await saving).status()).toBe(200);
    await expect(page.getByLabel('AI设置保存栏', { exact: true }).getByRole('status')).toContainText('配置已保存');

    const loading = page.waitForResponse(r => r.url().endsWith('/api/ai/config') && r.request().method() === 'GET');
    await page.reload();
    const response = await loading;
    expect(response.status()).toBe(200);
    const { config } = await response.json();
    // Only assert redacted responses, not raw keys or request payloads.
    const providers = config.providers.filter((p: { name: string }) => [firstName, secondName].includes(p.name));
    expect(providers).toHaveLength(2);
    expect(providers.map((p: { baseUrl: string }) => p.baseUrl)).toEqual([endpoint, endpoint]);
    expect(providers.every((p: { apiKey: string }) => p.apiKey === '********')).toBe(true);
    const ids = providers.map((p: { id: string }) => p.id);
    const models = config.models.filter((m: { providerId: string }) => ids.includes(m.providerId));
    expect(models).toHaveLength(3);
    expect(models.map((m: { capabilities: string[] }) => m.capabilities)).toEqual([
        ['text'], ['text', 'vision'], ['text'],
    ]);
    expect(config.chains.text.filter((id: string) => models.some((m: { id: string }) => m.id === id)))
        .toEqual(models.map((m: { id: string }) => m.id));
    expect(config.chains.vision.filter((id: string) => models.some((m: { id: string }) => m.id === id)))
        .toEqual([models[1].id]);

    await page.getByRole('button', { name: firstName, exact: true }).click();
    const persisted = page.getByRole('dialog');
    await expect(persisted.getByLabel('API密钥', { exact: true })).toHaveValue('********');
    await expect(persisted.getByLabel('上游模型/部署名', { exact: true }).nth(1)).toHaveValue('synthetic-vision');
    await expect(persisted.getByLabel('支持读图（多模态）', { exact: true }).nth(1)).toBeChecked();
    await expect(persisted.getByRole('button', { name: '保存全部AI设置', exact: true })).toBeVisible();
    await persisted.getByRole('button', { name: '关闭（保留草稿）', exact: true }).click();
    // Export is forbidden by default, including for administrators.
    await expect(page.getByRole('button', { name: '导出配置', exact: true })).toHaveCount(0);
    const capability = await page.request.get('/api/ai/config/export');
    expect(capability.status()).toBe(200);
    expect(await capability.json()).toEqual({ exportEnabled: false });
    const before = await (await page.request.get('/api/ai/config')).json();
    const denied = await page.request.post('/api/ai/config/export', {
        headers: { Origin: baseURL! }, data: { revision: before.revision, password: `synthetic-${randomUUID()}` },
    });
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toEqual({ message: 'AI_CONFIG_EXPORT_DISABLED' });

    // Download ONLY the public empty template, then preview a locally supplied import.
    const downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载导入模板', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('solvnote-ai-config.template.json');
    const bytes = await readFile((await download.path())!);
    const template = JSON.parse(bytes.toString('utf8'));
    expect(template.providers.every((p: { apiKey: string }) => p.apiKey === '')).toBe(true);
    expect(template.providers.some((p: { name: string }) => p.name === firstName || p.name === secondName)).toBe(false);
    await page.getByRole('button', { name: '导入配置', exact: true }).click();
    await page.getByLabel('加密配置文件', { exact: true }).setInputFiles({ name: 'synthetic-template.json', mimeType: 'application/json', buffer: bytes });
    const previewing = page.waitForResponse(r => r.url().endsWith('/api/ai/config/import'));
    await page.getByRole('button', { name: '预览模板（不写入）', exact: true }).click();
    expect((await previewing).status()).toBe(200);
    expect((await (await page.request.get('/api/ai/config')).json()).revision).toBe(before.revision);
    expect(externalRequests).toEqual([]);
});

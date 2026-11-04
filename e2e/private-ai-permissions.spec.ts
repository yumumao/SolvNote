import { randomUUID } from 'node:crypto';
import { test, expect } from './session-fixture';
import { sealExport } from '../src/lib/ai-config/crypto';

test('Member edits only their private AI, never site settings or another user vault', async ({ page, context, browser, member, signInAs, baseURL }) => {
    const externalRequests: string[] = [];
    await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== baseURL) {
            externalRequests.push('blocked');
            return route.abort();
        }
        return route.continue();
    });
    await signInAs(member.id);
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: 'AI设置', exact: true }).click();
    await expect(page.getByRole('link', { name: '管理站点AI配置、模型顺序与导入' })).toHaveCount(0);
    await page.getByRole('link', { name: '设置或导入我的AI配置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '我的AI设置', exact: true })).toBeVisible();
    await expect(page.getByText('暂无站点授权；仍可添加自己的私有AI。')).toBeVisible();
    await expect(page.getByRole('button', { name: /导出/ })).toHaveCount(0);
    for (const endpoint of ['/api/admin/users', '/api/admin/registration', '/api/ai/config', '/api/ai/config/export']) {
        expect((await page.request.get(endpoint)).status()).toBe(403);
    }
    await page.goto('/admin/ai');
    await expect(page).toHaveURL(`${baseURL}/`);
    await page.goto('/ai-settings');
    const connection = `E2E private ${randomUUID()}`;
    await page.getByRole('button', { name: '添加私有连接', exact: true }).click();
    await page.getByLabel('连接名称', { exact: true }).fill(connection);
    await page.getByLabel('HTTPS连接地址', { exact: true }).fill('https://example.com/v1');
    await page.getByLabel('密钥', { exact: true }).fill(`synthetic-${randomUUID()}`);
    await page.getByRole('button', { name: '添加模型', exact: true }).click();
    await page.getByLabel('模型名称', { exact: true }).fill('E2E private model');
    await page.getByLabel('上游模型ID', { exact: true }).fill('synthetic-private-model');
    const saving = page.waitForResponse(r => r.url().endsWith('/api/user/ai-config') && r.request().method() === 'PUT');
    await page.getByRole('button', { name: '保存私有AI', exact: true }).click();
    expect((await saving).status()).toBe(200);
    await expect(page.getByRole('status')).toContainText('已保存');
    await expect(page.getByLabel('密钥', { exact: true })).toBeEmpty();
    const snapshot = await (await page.request.get('/api/user/ai-config')).json();
    expect(snapshot.config.providers).toHaveLength(1);
    expect(snapshot.config.providers[0].name).toBe(connection);
    expect(snapshot.config.providers[0].hasKey).toBe(true);
    expect(Object.hasOwn(snapshot.config.providers[0], 'apiKey')).toBe(false);
    expect(snapshot.siteModels).toEqual([]);
    // File imports use the same owner-scoped API for plaintext and encrypted files.
    const imported = {
        version: 1,
        providers: [{ id: 'personal-import', name: 'Imported personal connection', protocol: 'chat', baseUrl: 'https://example.com/v1', apiKey: 'synthetic-import-only', enabled: true }],
        models: [{ id: 'personal-model', providerId: 'personal-import', name: 'Imported model', model: 'synthetic-model', capabilities: ['text'], enabled: true }],
        chains: { text: ['personal-model'], vision: [] },
    };
    await page.getByLabel('本地JSON文件').setInputFiles({ name: 'personal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    const merging = page.waitForResponse(r => r.url().endsWith('/api/user/ai-config/import') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '确认导入私有配置', exact: true }).click();
    expect((await merging).status()).toBe(200);
    await expect(page.getByLabel('连接名称', { exact: true })).toHaveCount(2);
    const password = 'synthetic-import-passphrase';
    const encrypted = await sealExport(imported, password);
    await page.getByLabel('本地JSON文件').setInputFiles({ name: 'personal-encrypted.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(encrypted)) });
    await page.getByLabel('解密口令', { exact: true }).fill(password);
    await page.getByLabel('导入方式').selectOption('replace');
    const replacing = page.waitForResponse(r => r.url().endsWith('/api/user/ai-config/import') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '确认导入私有配置', exact: true }).click();
    expect((await replacing).status()).toBe(200);
    await expect(page.getByLabel('连接名称', { exact: true })).toHaveCount(1);
    await expect(page.getByLabel('连接名称', { exact: true })).toHaveValue('Imported personal connection');
    await expect(page.getByLabel('密钥', { exact: true })).toBeEmpty();
    await page.reload();
    await expect(page.getByLabel('连接名称', { exact: true })).toHaveValue('Imported personal connection');
    const personal = await (await page.request.get('/api/user/ai-config')).json();
    expect(JSON.stringify(personal)).not.toMatch(/apiKey|synthetic-import-only/);
    // Even an admin's PERSONAL endpoint cannot read another vault by changing a query id.
    const admin = await browser.newContext({ baseURL });
    try {
        await signInAs(undefined, admin);
        const own = await admin.request.get(`/api/user/ai-config?userId=${encodeURIComponent(member.id)}`);
        expect(own.status()).toBe(200);
        expect((await own.json()).config.providers).toEqual([]);
        const site = await admin.request.get('/api/ai/config');
        expect(site.status()).toBe(200);
        expect((await site.json()).config.providers.some((p: { name: string }) => p.name === connection || p.name === 'Imported personal connection')).toBe(false);
    } finally { await admin.close(); }
    expect(externalRequests).toEqual([]);
});

import { randomUUID } from 'node:crypto';
import { test, expect } from './session-fixture';

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
    await page.goto('/ai-settings');
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
    // Even an admin's PERSONAL endpoint cannot read another vault by changing a query id.
    const admin = await browser.newContext({ baseURL });
    try {
        await signInAs(undefined, admin);
        const own = await admin.request.get(`/api/user/ai-config?userId=${encodeURIComponent(member.id)}`);
        expect(own.status()).toBe(200);
        expect((await own.json()).config.providers).toEqual([]);
        const site = await admin.request.get('/api/ai/config');
        expect(site.status()).toBe(200);
        expect((await site.json()).config.providers.some((p: { name: string }) => p.name === connection)).toBe(false);
    } finally { await admin.close(); }
    expect(externalRequests).toEqual([]);
});

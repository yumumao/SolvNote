import { randomUUID, pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

// Seed and login share this explicit fixture; never use a deployment default.
const adminPassword = process.env.INITIAL_ADMIN_PASSWORD ?? '';
if (adminPassword.length < 12) {
    throw new Error('E2E requires INITIAL_ADMIN_PASSWORD with at least 12 characters');
}

test('Admin saves two-layer connections, models and capabilities without exposing keys', async ({ page }) => {
    test.setTimeout(60000);
    // Only exercise our own app. Saving configuration must not contact a provider.
    const externalRequests: string[] = [];
    await page.route('**/*', async route => {
        if (new URL(route.request().url()).origin !== 'http://127.0.0.1:3000') {
            externalRequests.push('blocked');
            return route.abort();
        }
        return route.continue();
    });

    await page.goto('/login');
    await page.locator('input[name="email"]').fill('admin@localhost');
    await page.locator('input[name="password"]').fill(adminPassword);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/', { timeout: 15000 });

    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('tab', { name: /AI Provider|AI 提供商/ }).click();
    await page.getByRole('link', { name: '打开AI配置、模型顺序与加密导入' }).click();
    await expect(page.getByRole('heading', { name: 'AI设置', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('配置仅管理员可见');

    const suffix = randomUUID();
    const firstName = `E2E connection ${suffix}`;
    const secondName = `E2E alternate ${suffix}`;
    const endpoint = 'https://example.com/v1';
    await page.getByRole('button', { name: '＋添加连接', exact: true }).click();
    await page.locator('details[open]').getByLabel('连接名称', { exact: true }).fill(firstName);
    const first = page.locator('details').filter({
        has: page.locator('summary > strong').filter({ hasText: new RegExp(`^${firstName}$`) }),
    });
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
    const second = page.locator('details[open]').filter({ has: page.getByLabel('连接名称', { exact: true }) });
    await second.getByLabel('连接名称', { exact: true }).fill(secondName);
    await expect(second.getByLabel('API基础地址', { exact: true })).toHaveValue(endpoint);
    await expect(second.getByLabel('API密钥', { exact: true })).toBeEmpty();
    await second.getByLabel('API密钥', { exact: true }).fill(`synthetic-${randomUUID()}`);
    await second.getByRole('button', { name: '＋添加模型', exact: true }).click();
    await second.getByLabel('显示名称', { exact: true }).fill('E2E alternate text');
    await second.getByLabel('上游模型/部署名', { exact: true }).fill('synthetic-text');

    const saving = page.waitForResponse(r => r.url().endsWith('/api/ai/config') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    expect((await saving).status()).toBe(200);
    await expect(page.getByRole('status')).toContainText('配置已保存');

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

    await page.locator('summary').filter({ hasText: firstName }).click();
    const persisted = page.locator('details[open]').filter({ has: page.getByLabel('连接名称', { exact: true }) });
    await expect(persisted.getByLabel('API密钥', { exact: true })).toHaveValue('********');
    await persisted.locator('summary').filter({ hasText: 'E2E vision' }).click();
    await expect(persisted.getByLabel('上游模型/部署名', { exact: true }).nth(1)).toHaveValue('synthetic-vision');
    await expect(persisted.getByLabel('支持读图（多模态）', { exact: true }).nth(1)).toBeChecked();
    // Native browser download + independent Node decryption + actual import preview.
    await expect(page.locator('summary').filter({hasText:'站点地址检查'})).toContainText('地址一致');
    const savedRevision = (await page.request.get('/api/ai/config').then(r=>r.json())).revision;
    await page.getByRole('button',{name:'导出配置',exact:true}).click();
    const passphrase = 'synthetic-' + randomUUID();
    await page.getByLabel('设置导出口令',{exact:true}).fill(passphrase);
    await page.getByLabel('再次输入导出口令',{exact:true}).fill(passphrase);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button',{name:'加密并下载',exact:true}).click();
    const download=await downloading;
    expect(download.suggestedFilename()).toBe('wrong-notebook.aiconfig.enc.json');
    const bytes=await readFile((await download.path())!);expect(bytes.length).toBeLessThanOrEqual(1024*1024);
    const envelope=JSON.parse(bytes.toString('utf8'));
    expect(Object.keys(envelope).sort()).toEqual(['format','v','alg','kdf','iter','salt','iv','data'].sort());
    expect(envelope.format).toBe('portable-ai-config');expect(envelope.v).toBe(1);expect(envelope.iter).toBe(300000);
    const key=pbkdf2Sync(passphrase,Buffer.from(envelope.salt,'base64'),300000,32,'sha256');
    const cipher=Buffer.from(envelope.data,'base64');
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
    decipher.setAuthTag(cipher.subarray(-16));
    const restored=JSON.parse(Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]).toString('utf8'));
    expect(restored.chains).toEqual(config.chains);expect(restored.models).toEqual(config.models);
    expect(restored.providers.filter((p:{name:string})=>[firstName,secondName].includes(p.name))).toHaveLength(2);
    expect(bytes.toString('utf8').includes(passphrase)).toBe(false);
    for(const p of restored.providers) if(p.apiKey) expect(bytes.toString('utf8').includes(p.apiKey)).toBe(false);
    await expect(page.getByLabel('设置导出口令',{exact:true})).toBeEmpty();
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'导入配置',exact:true}).click();
    await page.getByLabel('加密配置文件').setInputFiles({name:'synthetic.aiconfig.enc.json',mimeType:'application/json',buffer:bytes});
    await page.getByLabel('导出口令',{exact:true}).fill(passphrase);
    const previewing=page.waitForResponse(r=>r.url().endsWith('/api/ai/config/import'));
    await page.getByRole('button',{name:'解密并预览（不写入）',exact:true}).click();
    const previewResponse=await previewing;expect(previewResponse.status()).toBe(200);
    const preview=await previewResponse.json();expect(preview.config.models).toEqual(config.models);
    expect((await page.request.get('/api/ai/config').then(r=>r.json())).revision).toBe(savedRevision);
    expect(externalRequests).toEqual([]);
});

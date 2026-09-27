import { test, expect } from './session-fixture';

test('Unauthenticated pages and APIs remain protected', async ({ page }) => {
    await page.goto('/notebooks');
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    expect((await page.request.get('/api/admin/users')).status()).toBe(401);
    expect((await page.request.get('/api/user/ai-config')).status()).toBe(401);
});

test('Login without Turnstile fails closed even with the correct seeded password', async ({ page, context, baseURL }) => {
    await page.goto('/login');
    await expect(page.getByRole('alert').filter({ hasText: /验证未配置|verification is not configured/i })).toBeVisible();
    await page.locator('input[name="email"]').fill(process.env.INITIAL_ADMIN_EMAIL || 'admin@localhost');
    await page.locator('input[name="password"]').fill(process.env.INITIAL_ADMIN_PASSWORD!);
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    // Bypass ONLY the browser form, not server authentication: valid credentials still fail.
    for (const token of [undefined, '']) {
        const csrf = await page.request.get('/api/auth/csrf');
        expect(csrf.status()).toBe(200);
        const { csrfToken } = await csrf.json();
        const response = await page.request.post('/api/auth/callback/credentials', {
            headers: { Origin: baseURL! },
            form: { csrfToken, email: process.env.INITIAL_ADMIN_EMAIL || 'admin@localhost',
                password: process.env.INITIAL_ADMIN_PASSWORD!, callbackUrl: baseURL!, json: 'true',
                ...(token === undefined ? {} : { turnstileToken: token }) },
        });
        expect(response.status()).toBe(401);
        expect(new URL((await response.json()).url).searchParams.get('error')).toBe('CredentialsSignin');
        expect((await context.cookies()).some(cookie => cookie.name === 'next-auth.session-token')).toBe(false);
        const session = await page.request.get('/api/auth/session');
        expect((await session.json()).user).toBeUndefined();
    }
});

test('Registration defaults closed and reports no secret or displayed invite', async ({ page, baseURL }) => {
    const status = await page.request.get('/api/registration/status');
    expect(status.status()).toBe(200);
    const body = await status.json();
    expect(body).toEqual({ enabled: false, inviteRequired: false, inviteCode: null,
        turnstileSiteKey: '', turnstileConfigured: false });
    expect(await (await page.request.get('/api/register/status')).json()).toEqual({ ...body, allowRegistration: false });
    await page.goto('/register');
    await expect(page.getByRole('alert').filter({ hasText: /关闭|禁用|disabled/i })).toHaveCount(2);
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    await expect(page.locator('input[name="password"]')).toHaveAttribute('minlength', '15');
    const request = { email: 'e2e-register@example.invalid', name: 'E2E registration', password: process.env.INITIAL_ADMIN_PASSWORD! };
    const missing = await page.request.post('/api/register', { headers: { Origin: baseURL! }, data: request });
    expect(missing.status()).toBe(400);
    const disabled = await page.request.post('/api/register', { headers: { Origin: baseURL! }, data: { ...request, turnstileToken: 'synthetic-invalid-token' } });
    expect(disabled.status()).toBe(403);
    expect(await disabled.json()).toEqual({ error: 'REGISTRATION_DISABLED' });
});

test('Admin cannot enable registration when Turnstile is unconfigured', async ({ page, signInAs, baseURL }) => {
    await signInAs();
    const policy = await (await page.request.get('/api/admin/registration')).json();
    const response = await page.request.patch('/api/admin/registration', {
        headers: { Origin: baseURL! }, data: { revision: policy.revision, enabled: true },
    });
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ error: 'TURNSTILE_NOT_CONFIGURED' });
    expect((await (await page.request.get('/api/registration/status')).json()).enabled).toBe(false);
});

test('Test JWT uses the live sessionVersion and is rejected after revocation', async ({ page, signInAs, member, db }) => {
    await signInAs(member.id);
    const session = await (await page.request.get('/api/auth/session')).json();
    expect(session.user.id).toBe(member.id);
    await page.goto('/notebooks');
    await expect(page).toHaveURL(/\/notebooks$/);
    await db.user.update({ where: { id: member.id }, data: { sessionVersion: { increment: 1 } } });
    expect((await page.request.get('/api/user/ai-config')).status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
});

test('A forced password-change session cannot bypass the live account flag', async ({ page, signInAs, member, db }) => {
    await db.user.update({ where: { id: member.id }, data: { mustChangePassword: true } });
    await signInAs(member.id);
    await page.goto('/');
    await expect(page).toHaveURL(/\/change-password$/);
    expect((await page.request.get('/api/user/ai-config')).status()).toBe(403);
    await expect(page.locator('input[name="newPassword"]')).toHaveAttribute('minlength', '15');
});

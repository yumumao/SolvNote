import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'user' }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'synthetic-user', role: state.role } } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: {}, language: 'zh', setLanguage: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(async () => ({})) } }));
import { SettingsDialog } from '@/components/settings-dialog';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
    state.role = 'user';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 'synthetic' })));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});
async function openAI() {
    await act(async () => root.render(<SettingsDialog />));
    await act(async () => host.querySelector('button')!.click());
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => /AI/.test(tab.textContent || ''));
    expect(tab, 'all signed-in accounts can reach personal AI from Settings').toBeDefined();
    await act(async () => tab!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(tab!.getAttribute('aria-selected')).toBe('true');
}
it('ordinary accounts can find personal AI and import without any site management entry', async () => {
    await openAI();
    expect(document.querySelector('a[href="/ai-settings"]')?.textContent).toContain('导入');
    expect(document.querySelector('a[href="/admin/ai"]')).toBeNull();
    expect(document.querySelector('[role="tab"][data-state="active"]')?.textContent).toContain('AI');
    expect(document.body.textContent).not.toContain('AI配置已升级');
});
it('administrators retain site management alongside their personal AI entry', async () => {
    state.role = 'admin';
    await openAI();
    expect(document.querySelector('a[href="/admin/ai"]')).not.toBeNull();
    expect(document.querySelector('a[href="/ai-settings"]')).not.toBeNull();
});

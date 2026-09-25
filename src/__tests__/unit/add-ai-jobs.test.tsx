import type { AIConversation } from "@/components/ai-conversation";
import { act, createElement, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CorrectionEditor } from '@/components/correction-editor';
import type { ImageCropper } from '@/components/image-cropper';
import type { UploadZone } from '@/components/upload-zone';
import type { TextInputZone } from '@/components/text-input-zone';
import type { ParsedQuestion } from '@/lib/ai/types';

const mocks = vi.hoisted(() => ({
    conversation: null as ComponentProps<typeof AIConversation> | null,
    search: '', notebookId: 'owned-notebook', router: { push: vi.fn(), replace: vi.fn() }, processImage: vi.fn(),
    editor: null as ComponentProps<typeof CorrectionEditor> | null,
    cropper: null as ComponentProps<typeof ImageCropper> | null,
    upload: null as ComponentProps<typeof UploadZone> | null,
    text: null as ComponentProps<typeof TextInputZone> | null,
    logger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: mocks.notebookId }), useSearchParams: () => new URLSearchParams(mocks.search), useRouter: () => mocks.router }));
vi.mock('@/lib/image-utils', () => ({ processImageFile: mocks.processImage }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: mocks.logger }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'zh', t: { app: {}, common: { messages: {} }, errors: {} } }) }));
vi.mock('@/components/ui/progress-feedback', () => ({ ProgressFeedback: ({ status }: { status: string }) => createElement('div', { 'data-overlay-status': status }) }));
vi.mock('@/components/correction-editor', () => ({ CorrectionEditor: (props: ComponentProps<typeof CorrectionEditor>) => { mocks.editor = props; const [initial] = useState(props.initialData); return createElement('div', { 'data-testid': 'editor' }, initial.answerText); } }));
vi.mock('@/components/image-cropper', () => ({ ImageCropper: (props: ComponentProps<typeof ImageCropper>) => { mocks.cropper = props; return null; } }));
vi.mock('@/components/upload-zone', () => ({ UploadZone: (props: ComponentProps<typeof UploadZone>) => { mocks.upload = props; return null; } }));
vi.mock('@/components/text-input-zone', () => ({ TextInputZone: (props: ComponentProps<typeof TextInputZone>) => { mocks.text = props; return null; } }));
import AddPage from '@/app/notebooks/[id]/add/page';

vi.mock("@/components/ai-conversation", () => ({ AIConversation: (props: ComponentProps<typeof AIConversation>) => { mocks.conversation = props; return null; } }));

const original = 'data:image/jpeg;base64,b3JpZ2luYWw=';
const compressed = 'data:image/jpeg;base64,Y29tcHJlc3NlZA==';
const result: ParsedQuestion = { questionText: '合成题目', answerText: '合成答案', analysis: '合成解析', subject: '数学', knowledgePoints: [], wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'unknown', requiresImage: true };
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
let jobState: string;
let restoreStatus: number;
let restoreInput: Record<string, unknown>;
let jobKind: string;
let jobResult: unknown;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('alert', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('FileReader', class { result = original; onload: (() => void) | null = null; readAsDataURL() { this.onload?.(); } });
    URL.createObjectURL = vi.fn(() => 'blob:synthetic-crop'); URL.revokeObjectURL = vi.fn();
    mocks.search = ''; mocks.notebookId = 'owned-notebook';
    mocks.editor = null; mocks.cropper = null; mocks.upload = null; mocks.text = null;
    mocks.processImage.mockResolvedValue(compressed);
    jobState = 'success'; restoreStatus = 200; jobKind = 'analyze'; jobResult = result;
    restoreInput = { subjectId: 'owned-notebook', originalImageBase64: original, imageBase64: compressed };
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('/api/notebooks/')) return response({ id: mocks.notebookId, name: '数学' });
        if (url === '/api/settings') return response({ timeouts: { analyze: 180000 } });
        if (url === '/api/ai/conversations') return response({id:'synthetic-conversation'},201);
        if (url === '/api/analyze') return response({ jobId: 'owned-job' }, 202);
        if (url === '/api/ai/jobs/owned-job?restore=1') return response({ id: 'owned-job', kind: jobKind, state: jobState, input: restoreInput, result: jobResult }, restoreStatus);
        if (url === '/api/ai/jobs/owned-job') return response({ id: 'owned-job', state: jobState, result: jobResult });
        if (url === '/api/error-items' && init?.method === 'POST') return response({ id: 'saved-item' });
        throw new Error('Unexpected mock endpoint');
    });
    vi.stubGlobal('fetch', fetchMock);
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
    await act(async () => { root.unmount(); await vi.runOnlyPendingTimersAsync(); });
    host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const render = async () => { await act(async () => { root.render(createElement(AddPage)); }); };
const bodyFor = (path: string) => {
    const body = fetchMock.mock.calls.find(([url, init]) => url === path && init?.method === 'POST')?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON POST body');
    return JSON.parse(body);
};
const crop = async (size = 10) => {
    await act(async () => { mocks.upload!.onImageSelect(new File(['source'], 'source.jpg')); });
    await act(async () => { mocks.cropper!.onCropComplete(new Blob([new Uint8Array(size)], { type: 'image/jpeg' })); });
};
const direct = async()=>{await act(async()=>{const select=host.querySelector<HTMLSelectElement>('[aria-label="解题方式"]')!;select.value="direct";select.dispatchEvent(new Event("change",{bubbles:true}));});};
const textTab = async () => { await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '手动输入')!.click(); }); };
const writes = () => fetchMock.mock.calls.filter(([, init]) => ['POST', 'DELETE'].includes(init?.method || ''));

describe('notebook add durable jobs (synthetic, real apiClient + mocked fetch)', () => {
    it('retains crop original separately from compressed request and saves to the current notebook', async () => {
        await render(); await direct(); await crop();
        expect(bodyFor('/api/analyze')).toMatchObject({ imageBase64: compressed, originalImageBase64: original, subjectId: 'owned-notebook', mode: 'direct', review: false });
        expect(mocks.editor?.imagePreview).toBe(original);
        await act(async () => { await mocks.editor!.onSave({ ...result, subjectId: 'other-notebook' }); });
        expect(bodyFor('/api/error-items')).toMatchObject({ originalImageUrl: original, subjectId: 'owned-notebook' });
    });
    it('sends supplemental text, transcribe, and optional review with the original', async () => {
        await render();
        await act(async () => {
            const text = host.querySelector('textarea')!;
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, '合成补充文字'); text.dispatchEvent(new Event('input', { bubbles: true }));
            const select = host.querySelector('select')!; select.value = 'transcribe'; select.dispatchEvent(new Event('change', { bubbles: true }));
            host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
        });
        await crop();
        expect(bodyFor('/api/analyze')).toMatchObject({ questionText: '合成补充文字', mode: 'transcribe', review: true, originalImageBase64: original });
    });
    it.each([8 * 1024 * 1024, 8 * 1024 * 1024 + 1])('enforces the cropped file boundary (%i bytes)', async (size) => {
        await render(); await crop(size);
        expect(mocks.processImage).toHaveBeenCalledTimes(size > 8 * 1024 * 1024 ? 0 : 1);
        if (size > 8 * 1024 * 1024) { expect(writes()).toHaveLength(0); expect(alert).toHaveBeenCalledWith(expect.stringContaining('8MiB')); }
    });
    it('submits text through analyze 202 with notebook context and no image or fake subject', async () => {
        await render(); await direct(); await textTab();
        await act(async () => { await mocks.text!.onSubmit('合成文字题'); });
        expect(bodyFor('/api/analyze')).toMatchObject({ questionText: '合成文字题', mode: 'text', subjectId: 'owned-notebook' });
        expect(bodyFor('/api/analyze').imageBase64).toBeUndefined(); expect(bodyFor('/api/analyze').subject).toBeUndefined();
        expect(mocks.editor?.imagePreview).toBeNull(); expect(mocks.editor?.initialData).toEqual(result);
    });
    it('restores pending tasks by polling without another POST and preserves the original', async () => {
        mocks.search = 'job=owned-job'; jobState = 'pending'; await render();
        expect(mocks.upload?.isAnalyzing).toBe(true); expect(mocks.editor).toBeNull();
        jobState = 'success'; await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
        expect(mocks.editor?.imagePreview).toBe(original); expect(writes()).toHaveLength(0);
    });
    it.each(['other-notebook', undefined])('refuses a restore outside this subject (%s) before polling', async (subjectId) => {
        mocks.search = 'job=owned-job'; restoreInput.subjectId = subjectId; jobState = 'pending'; await render();
        expect(mocks.editor).toBeNull(); expect(mocks.upload?.isAnalyzing).toBe(false);
        expect(host.textContent).toMatch(/不属于|错题本/);
        expect(fetchMock.mock.calls.some(([url]) => url === '/api/ai/jobs/owned-job')).toBe(false);
    });
    it.each(['failed', 'cancelled', 'unknown'])('never resubmits or edits a terminal %s task', async (state) => {
        mocks.search = 'job=owned-job'; jobState = state; await render();
        expect(mocks.editor).toBeNull(); expect(writes()).toHaveLength(0); expect(host.textContent).toContain('不要连续重复提交');
    });
    it('keeps owner authorization and job kind checks on restored results', async () => {
        mocks.search = 'job=owned-job'; restoreStatus = 404; await render();
        expect(mocks.editor).toBeNull(); expect(host.textContent).toMatch(/不可访问/);
        mocks.search = 'job=owned-job&retry=1'; jobKind = 'geogebra'; restoreStatus = 200;
        await act(async () => { root.render(null); }); await render(); expect(mocks.editor).toBeNull();
    });
    it('supports legacy request-image fallback and text-only restore', async () => {
        mocks.search = 'job=owned-job'; delete restoreInput.originalImageBase64; await render();
        expect(mocks.editor?.imagePreview).toBe(compressed);
        await act(async () => { root.render(null); }); delete restoreInput.imageBase64; restoreInput.mode = 'text'; await render();
        expect(mocks.editor?.imagePreview).toBeNull(); expect(mocks.editor?.initialData).toEqual(result);
    });
    it('does not publish malformed results or raw upstream errors to UI/logs', async () => {
        mocks.search = 'job=owned-job'; jobResult = { upstreamDiagnostic: 'synthetic-private-diagnostic' }; await render();
        expect(mocks.editor).toBeNull(); expect(host.textContent).not.toContain('synthetic-private-diagnostic');
        expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain('synthetic-private-diagnostic');
    });
    it('stops only local polling on unmount, including image compression still in flight', async () => {
        let resolve!: (value: string) => void;
        mocks.processImage.mockImplementation(() => new Promise<string>(r => { resolve = r; }));
        await render(); await direct(); await crop();
        await act(async () => { root.render(null); });
        await act(async () => { resolve(compressed); });
        expect(writes()).toHaveLength(0);
    });
    it('stops pending restore polling on unmount without cancelling the backend job', async () => {
        mocks.search = 'job=owned-job'; jobState = 'running'; await render();
        await act(async () => { root.render(null); }); const count = fetchMock.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
        expect(fetchMock.mock.calls).toHaveLength(count); expect(writes()).toHaveLength(0);
    });
    it('unlocks on query-only navigation and aborts the previous local wait', async () => {
        mocks.search = 'job=owned-job'; jobState = 'pending'; await render();
        mocks.search = ''; await render(); const count = fetchMock.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(mocks.upload?.isAnalyzing).toBe(false); expect(fetchMock.mock.calls).toHaveLength(count); expect(writes()).toHaveLength(0);
    });
    it('guards duplicate submissions, keeps forms busy past 180s but leaves task navigation available', async () => {
        jobState = 'running'; await render(); await direct(); await crop(); await crop();
        await act(async () => { await vi.advanceTimersByTimeAsync(191000); });
        expect(mocks.upload?.isAnalyzing).toBe(true); expect(writes()).toHaveLength(1);
        expect(host.querySelector('[data-overlay-status=analyzing]')).toBeNull();
        expect(host.querySelector('a[href="/ai-tasks"]')).not.toBeNull(); expect(host.querySelector('a[href*="job=owned-job"]')).not.toBeNull();
    });
    it('deduplicates text submits and stops only local polling on navigation', async () => {
        jobState = 'pending'; await render(); await direct(); await textTab();
        await act(async () => { void mocks.text!.onSubmit('合成文字题'); void mocks.text!.onSubmit('重复提交'); });
        expect(writes()).toHaveLength(1);
        await act(async () => { root.render(null); }); const count = fetchMock.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(fetchMock.mock.calls).toHaveLength(count); expect(writes()).toHaveLength(1);
    });
    it('aborts the old request and clears editor state when notebook context changes', async () => {
        mocks.search = 'job=owned-job'; jobState = 'pending'; await render();
        mocks.notebookId = 'next-notebook'; mocks.search = ''; await render();
        const count = fetchMock.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(mocks.editor).toBeNull(); expect(mocks.upload?.isAnalyzing).toBe(false);
        expect(fetchMock.mock.calls).toHaveLength(count); expect(writes()).toHaveLength(0);
    });
    it('does not echo raw server diagnostics from a rejected submission', async () => {
        const normalFetch = fetchMock.getMockImplementation()!;
        fetchMock.mockImplementation((url: string, init?: RequestInit) => url === '/api/analyze'
            ? Promise.resolve(response({ message: 'synthetic-private-diagnostic' }, 500)) : normalFetch(url, init));
        await render(); await direct(); await crop();
        expect(mocks.editor).toBeNull(); expect(host.textContent).not.toContain('synthetic-private-diagnostic');
        expect(JSON.stringify(vi.mocked(alert).mock.calls)).not.toContain('synthetic-private-diagnostic');
        expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain('synthetic-private-diagnostic');
        expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('synthetic-private-diagnostic');
    });

    it('defaults to the durable conversation without waiting for a short-job result',async()=>{
        await render();expect(host.querySelector<HTMLSelectElement>('[aria-label="解题方式"]')?.value).toBe('conversation');await crop();
        expect(bodyFor('/api/ai/conversations')).toMatchObject({imageBase64:compressed,originalImageBase64:original,mode:'transcribe',subjectId:'owned-notebook'});
        expect(fetchMock.mock.calls.some(([u])=>u==='/api/analyze')).toBe(false);
        expect(mocks.router.replace).toHaveBeenCalledWith('/notebooks/owned-notebook/add?conversation=synthetic-conversation');
        expect(mocks.upload?.isAnalyzing).toBe(false);
    });
    it('creates a text-only conversation without fabricating an image',async()=>{
        await render();await textTab();await act(async()=>{await mocks.text!.onSubmit('synthetic text');});
        expect(bodyFor('/api/ai/conversations')).toMatchObject({questionText:'synthetic text',mode:'text'});
        expect(bodyFor('/api/ai/conversations').imageBase64).toBeUndefined();
    });

});


describe("shared inline conversation editor",()=>{
 it("renders the shared conversation without a second manual retrieval callback",async()=>{
  mocks.search="conversation=synthetic-conversation";await render();expect(mocks.conversation).toBeDefined();expect(mocks.conversation).not.toHaveProperty("onUseResult");
 });
});

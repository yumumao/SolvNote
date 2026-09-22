/** /api/reanswer集成测试：真实enqueue和输入校验，隔离外部存储与AI。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    session: vi.fn(),
    user: { findUnique: vi.fn() },
    subject: { findFirst: vi.fn() },
    submitJob: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, subject: mocks.subject } }));
vi.mock('@/lib/ai-jobs/store', () => ({ submitJob: mocks.submitJob }));

import { POST } from '@/app/api/reanswer/route';

const IMAGE = 'data:image/png;base64,AQID';
const ORIGINAL_IMAGE = 'data:image/jpeg;base64,BAUG';
function request(body: unknown, headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/reanswer', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-request-id': 'reanswer-request-1', ...headers },
        body: JSON.stringify(body),
    });
}

describe('POST /api/reanswer (202持久任务契约)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.session.mockResolvedValue({ user: { id: 'user-123', role: 'admin' } });
        mocks.user.findUnique.mockResolvedValue({
            id: 'user-123', role: 'user', isActive: true,
            educationStage: null, enrollmentYear: null,
        });
        mocks.submitJob.mockResolvedValue({ id: 'job-reanswer-1', state: 'pending' });
    });

    it('文字重解返回202，不在提交响应中返回答案', async () => {
        const response = await POST(request({ questionText: '求解 x + 2 = 5' }));
        expect(response.status).toBe(202);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({
            jobId: 'job-reanswer-1', state: 'pending', statusUrl: '/api/ai/jobs/job-reanswer-1',
        });
        expect(mocks.submitJob).toHaveBeenCalledExactlyOnceWith('user-123', 'reanswer',
            expect.objectContaining({ questionText: '求解 x + 2 = 5', language: 'zh' }), 'reanswer-request-1');
        expect(mocks.user.findUnique).toHaveBeenCalledWith({
            where: { id: 'user-123' }, select: { id: true, role: true, isActive: true },
        });
    });

    it('几何图与原始图片保留，不能降级为纯文字', async () => {
        const body = { questionText: '根据附图求角度', imageBase64: IMAGE, originalImageBase64: ORIGINAL_IMAGE, mimeType: 'image/png' };
        expect((await POST(request(body))).status).toBe(202);
        expect(mocks.submitJob).toHaveBeenCalledWith('user-123', 'reanswer', expect.objectContaining(body), 'reanswer-request-1');
    });

    it('纯图片也可提交重解任务', async () => {
        expect((await POST(request({ imageBase64: IMAGE }))).status).toBe(202);
        expect(mocks.submitJob).toHaveBeenCalledWith('user-123', 'reanswer',
            expect.objectContaining({ imageBase64: IMAGE, questionText: '' }), 'reanswer-request-1');
    });

    it('英文、年级与校正文本传入队列', async () => {
        const body = { questionText: 'Solve x + 2 = 5', language: 'en', gradeSemester: 'primary_3', subject: '数学' };
        expect((await POST(request(body))).status).toBe(202);
        expect(mocks.submitJob).toHaveBeenCalledWith('user-123', 'reanswer', expect.objectContaining(body), 'reanswer-request-1');
    });

    it('按owner校验学科，不信任客户端学科名称', async () => {
        mocks.subject.findFirst.mockResolvedValue({ name: '物理' });
        expect((await POST(request({ questionText: 'q', subjectId: 'physics-1', subject: '伪造名称' }))).status).toBe(202);
        expect(mocks.subject.findFirst).toHaveBeenCalledWith({ where: { id: 'physics-1', userId: 'user-123' } });
        expect(mocks.submitJob).toHaveBeenCalledWith('user-123', 'reanswer',
            expect.objectContaining({ subject: '物理' }), 'reanswer-request-1');
    });

    it('其他用户的学科返回404，不入队', async () => {
        mocks.subject.findFirst.mockResolvedValue(null);
        expect((await POST(request({ questionText: 'q', subjectId: 'foreign-subject' }))).status).toBe(404);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it('忽略客户端伪造的owner，任务始终属于当前用户', async () => {
        expect((await POST(request({ questionText: 'q', userId: 'other-user' }))).status).toBe(202);
        const [owner, , input] = mocks.submitJob.mock.calls[0];
        expect(owner).toBe('user-123');
        expect(input).not.toHaveProperty('userId');
    });

    it.each([null, { user: {} }])('无有效session返回401：%j', async (session) => {
        mocks.session.mockResolvedValue(session);
        expect((await POST(request({ questionText: 'q' }))).status).toBe(401);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it.each([null, { id: 'user-123', role: 'admin', isActive: false }])('实时用户不存在或停用返回403：%j', async (user) => {
        mocks.user.findUnique.mockResolvedValue(user);
        expect((await POST(request({ questionText: 'q' }))).status).toBe(403);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it('拒绝跨站重解请求', async () => {
        expect((await POST(request({ questionText: 'q' }, { origin: 'https://untrusted.example' }))).status).toBe(403);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it.each([
        {}, { questionText: '' }, { questionText: '   ' },
        { questionText: 'q', imageBase64: 'invalid...' },
        { questionText: 'q', imageBase64: IMAGE, mode: 'text' },
        { questionText: 'q', mimeType: 'image/svg+xml' },
    ])('缺失题目或无效图片请求返回400：%j', async (body) => {
        expect((await POST(request(body))).status).toBe(400);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it.each([
        ['长文本', '这是一道包含完整条件的题目。'.repeat(200)],
        ['特殊字符', 'a < b && b > c；x² + y² = z²；"引号"与换行\n条件'],
        ['LaTeX', String.raw`求解 $\frac{x+1}{2}=3$，保留 $\sqrt{x}$。`],
    ])('完整保留%s，不在提交时改写题目', async (_name, questionText) => {
        expect((await POST(request({ questionText }))).status).toBe(202);
        expect(mocks.submitJob).toHaveBeenCalledWith('user-123', 'reanswer', expect.objectContaining({ questionText }), 'reanswer-request-1');
    });

    it('已存在的任务仍返回202和真实状态，不重复同步解题', async () => {
        mocks.submitJob.mockResolvedValue({ id: 'job-existing', state: 'running' });
        const response = await POST(request({ questionText: 'q' }));
        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ jobId: 'job-existing', state: 'running', statusUrl: '/api/ai/jobs/job-existing' });
    });

    it.each([['AI_QUEUE_FULL', 429], ['REQUEST_CONFLICT', 409]])('队列拒绝%s时返回%d', async (code, status) => {
        mocks.submitJob.mockRejectedValue(new Error(code));
        const response = await POST(request({ questionText: 'q' }));
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ message: code });
    });
});

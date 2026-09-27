/**
 * /api/analyze集成测试：真实enqueue/鉴权/校验，仅mock会话、Prisma和队列存储。
 * 提交返回202，不同步执行AI，也不读取真实配置或数据库。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    session: vi.fn(),
    user: { findUnique: vi.fn() },
    subject: { findFirst: vi.fn() },
    submitJob: vi.fn(),
    calculateGrade: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, subject: mocks.subject } }));
vi.mock('@/lib/ai-jobs/store', () => ({ submitJob: mocks.submitJob }));
vi.mock('@/lib/grade-calculator', () => ({ calculateGrade: mocks.calculateGrade }));

import { POST } from '@/app/api/analyze/route';

const IMAGE = 'data:image/png;base64,AQID';
const ORIGINAL_IMAGE = 'data:image/jpeg;base64,BAUG';
function request(body: unknown, headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': 'analyze-request-1', ...headers },
        body: JSON.stringify(body),
    });
}

describe('POST /api/analyze (202持久任务契约)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.session.mockResolvedValue({ user: { id: 'user-123', role: 'admin' } });
        mocks.user.findUnique.mockResolvedValue({
            id: 'user-123', role: 'user', isActive: true, expiresAt: null, sessionVersion: 0, mustChangePassword: false,
            educationStage: null, enrollmentYear: null,
        });
        mocks.submitJob.mockResolvedValue({ id: 'job-analyze-1', state: 'pending' });
        mocks.calculateGrade.mockReturnValue('初二上');
    });

    it('纯文字题返回202、任务状态地址和no-store，而不是同步答案', async () => {
        const response = await POST(request({ questionText: '求解 x + 2 = 5', mode: 'text' }));
        expect(response.status).toBe(202);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({
            jobId: 'job-analyze-1', state: 'pending', statusUrl: '/api/ai/jobs/job-analyze-1',
        });
        expect(mocks.submitJob).toHaveBeenCalledExactlyOnceWith('user-123', 'analyze',
            expect.objectContaining({ questionText: '求解 x + 2 = 5', mode: 'text', language: 'zh', tags: [] }),
            'analyze-request-1');
        expect(mocks.user.findUnique).toHaveBeenCalledWith({
            where: { id: 'user-123' }, select: { id: true, role: true, isActive: true, expiresAt: true, sessionVersion: true, mustChangePassword: true, revision: true, aiAccessInitialized: true },
        });
    });

    it.each([
        { imageBase64: IMAGE, mimeType: 'image/png' },
        { imageBase64: 'AQID', mimeType: 'image/jpeg' },
        { questionText: '请根据附图解答', imageBase64: IMAGE, originalImageBase64: ORIGINAL_IMAGE, language: 'en' },
        { imageBase64: IMAGE, mode: 'transcribe', review: true },
    ])('图片/图文/转写输入原样交给队列：%j', async (body) => {
        expect((await POST(request(body))).status).toBe(202);
        expect(mocks.submitJob).toHaveBeenCalledWith('user-123', 'analyze',
            expect.objectContaining(body), 'analyze-request-1');
    });

    it('以实时用户为owner，丢弃客户端伪造的owner、状态和输出', async () => {
        expect((await POST(request({ questionText: 'q', userId: 'other-user', state: 'success', result: 'forged' }))).status).toBe(202);
        const [owner, , input] = mocks.submitJob.mock.calls[0];
        expect(owner).toBe('user-123');
        expect(input).not.toHaveProperty('userId');
        expect(input).not.toHaveProperty('state');
        expect(input).not.toHaveProperty('result');
    });

    it('按用户隔离学科查询，并采用数据库中的学科名称', async () => {
        mocks.subject.findFirst.mockResolvedValue({ id: 'physics-1', name: '物理' });
        expect((await POST(request({ questionText: 'q', subjectId: 'physics-1', subject: '伪造名称' }))).status).toBe(202);
        expect(mocks.subject.findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: 'physics-1', userId: 'user-123' } });
        expect(mocks.submitJob).toHaveBeenCalledWith('user-123', 'analyze',
            expect.objectContaining({ subjectId: 'physics-1', subject: '物理' }), 'analyze-request-1');
    });

    it('不存在或不属于当前用户的学科返回404，不入队', async () => {
        mocks.subject.findFirst.mockResolvedValue(null);
        const response = await POST(request({ questionText: 'q', subjectId: 'foreign-subject' }));
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ message: 'NOT_FOUND' });
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it('未给年级时使用用户档案推导，作为后续讲解偏好', async () => {
        mocks.user.findUnique.mockResolvedValue({
            id: 'user-123', role: 'user', isActive: true, expiresAt: null, sessionVersion: 0, mustChangePassword: false,
            educationStage: 'junior_high', enrollmentYear: 2025,
        });
        expect((await POST(request({ questionText: 'q' }))).status).toBe(202);
        expect(mocks.calculateGrade).toHaveBeenCalledWith('junior_high', 2025, expect.any(Date), 'zh');
        expect(mocks.submitJob).toHaveBeenCalledWith('user-123', 'analyze',
            expect.objectContaining({ gradeSemester: '初二上' }), 'analyze-request-1');
    });

    it('显式年级保留，不跳过实时身份检查', async () => {
        expect((await POST(request({ questionText: 'q', gradeSemester: 'primary_3' }))).status).toBe(202);
        expect(mocks.user.findUnique).toHaveBeenCalledTimes(1);
        expect(mocks.calculateGrade).not.toHaveBeenCalled();
        expect(mocks.submitJob).toHaveBeenCalledWith('user-123', 'analyze',
            expect.objectContaining({ gradeSemester: 'primary_3' }), 'analyze-request-1');
    });

    it.each([null, { user: {} }])('未登录或缺少session用户id返回401：%j', async (session) => {
        mocks.session.mockResolvedValue(session);
        const response = await POST(request({ questionText: 'q' }));
        expect(response.status).toBe(401);
        expect(mocks.user.findUnique).not.toHaveBeenCalled();
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it.each([null, { id: 'user-123', role: 'admin', isActive: false }])('失效/删除用户不能凭旧JWT入队：%j', async (user) => {
        mocks.user.findUnique.mockResolvedValue(user);
        expect((await POST(request({ questionText: 'q' }))).status).toBe(403);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it('实时鉴权数据库故障返回503且不暴露内部信息', async () => {
        mocks.user.findUnique.mockRejectedValue(new Error('synthetic-private-db-detail'));
        const response = await POST(request({ questionText: 'q' }));
        expect(await response.text()).not.toContain('synthetic-private-db-detail');
        expect(mocks.submitJob).not.toHaveBeenCalled();
        expect(response.status).toBe(503);
    });

    it.each([
        { origin: 'https://untrusted.example' },
        { 'sec-fetch-site': 'cross-site' },
    ] as Record<string, string>[])('跨站提交被拒绝：%j', async (headers) => {
        expect((await POST(request({ questionText: 'q' }, headers))).status).toBe(403);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it.each([
        {}, { questionText: '   ' }, { imageBase64: 'not-base64...' },
        { questionText: 'q', originalImageBase64: 'not-an-image' },
        { imageBase64: IMAGE, mode: 'text' }, { questionText: 'q', mode: 'transcribe' },
        { questionText: 'q', language: 'invalid' },
    ])('输入校验失败不入队：%j', async (body) => {
        expect((await POST(request(body))).status).toBe(400);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it('无效JSON返回400，不执行队列存储', async () => {
        const response = await POST(new Request('http://localhost/api/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
        }));
        expect(response.status).toBe(400);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it('没有请求id时生成幂等键', async () => {
        const response = await POST(new Request('http://localhost/api/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionText: 'q' }),
        }));
        expect(response.status).toBe(202);
        expect(mocks.submitJob.mock.calls[0][3]).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    });

    it('拒绝不合规的幂等键', async () => {
        expect((await POST(request({ questionText: 'q' }, { 'x-request-id': 'bad' }))).status).toBe(400);
        expect(mocks.submitJob).not.toHaveBeenCalled();
    });

    it.each([
        ['AI_QUEUE_FULL', 429], ['REQUEST_CONFLICT', 409],
    ])('队列错误%s使用异步提交契约%d', async (code, status) => {
        mocks.submitJob.mockRejectedValue(new Error(code));
        const response = await POST(request({ questionText: 'q' }));
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ message: code });
    });
});

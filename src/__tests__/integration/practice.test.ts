/**
 * /api/practice API 集成测试
 * 测试举一反三功能（生成类似题目和记录练习结果）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaErrorItem: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
    },
    mockPrismaUser: { findUnique: vi.fn() },
    mockPrismaSubject: { findFirst: vi.fn() },
    mockSubmitJob: vi.fn(),
    mockPrismaPracticeRecord: {
        create: vi.fn(),
    },
    mockAIService: {
        generateSimilarQuestion: vi.fn(),
    },
    mockSession: {
        user: {
            id: 'user-123',
            email: 'user@example.com',
            name: 'Test User',
        },
        expires: '2025-12-31',
    },
}));

// Mock Prisma client
vi.mock('@/lib/prisma', () => ({
    prisma: {
        errorItem: mocks.mockPrismaErrorItem,
        user: mocks.mockPrismaUser,
        subject: mocks.mockPrismaSubject,
        practiceRecord: mocks.mockPrismaPracticeRecord,
    },
}));

// Keep enqueue/auth/schema real; isolate durable storage, not the route itself.
vi.mock('@/lib/ai-jobs/store', () => ({ submitJob: mocks.mockSubmitJob }));

// Mock AI service
vi.mock('@/lib/ai', () => ({
    getAIService: vi.fn(() => mocks.mockAIService),
}));

// Mock next-auth
vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

// Import after mocks
import { POST as GENERATE_POST } from '@/app/api/practice/generate/route';
import { POST as RECORD_POST } from '@/app/api/practice/record/route';
import { getServerSession } from 'next-auth';

describe('/api/practice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
    });

    describe('POST /api/practice/generate (202持久任务契约)', () => {
        const IMAGE = 'data:image/png;base64,AQID';
        const mockErrorItem = {
            id: 'error-item-1', userId: 'user-123',
            questionText: '求解 x + 2 = 5', answerText: 'x = 3', analysis: '移项求解',
            knowledgePoints: '["一元一次方程", "移项"]',
            subject: { id: 'math', name: '数学' }, gradeSemester: '初二上',
            originalImageUrl: IMAGE,
        };
        function generateRequest(body: unknown, headers: Record<string, string> = {}) {
            return new Request('http://localhost/api/practice/generate', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-request-id': 'practice-request-1', ...headers },
                body: JSON.stringify(body),
            });
        }
        beforeEach(() => {
            mocks.mockPrismaUser.findUnique.mockReset().mockResolvedValue({
                id: 'user-123', role: 'user', isActive: true, expiresAt: null, sessionVersion: 0, mustChangePassword: false,
                educationStage: null, enrollmentYear: null,
            });
            mocks.mockPrismaErrorItem.findFirst.mockReset().mockResolvedValue(mockErrorItem);
            mocks.mockPrismaSubject.findFirst.mockReset();
            mocks.mockSubmitJob.mockReset().mockResolvedValue({ id: 'job-practice-1', state: 'pending' });
            mocks.mockAIService.generateSimilarQuestion.mockReset();
        });

        it('返回202任务地址，提交阶段不直接调用AI生成题目', async () => {
            const response = await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1' }));
            expect(response.status).toBe(202);
            expect(response.headers.get('Cache-Control')).toBe('no-store');
            expect(await response.json()).toEqual({
                jobId: 'job-practice-1', state: 'pending', statusUrl: '/api/ai/jobs/job-practice-1',
            });
            expect(mocks.mockSubmitJob).toHaveBeenCalledExactlyOnceWith('user-123', 'practice',
                expect.objectContaining({
                    errorItemId: 'error-item-1', questionText: mockErrorItem.questionText,
                    answerText: 'x = 3', analysis: '移项求解', subject: '数学', gradeSemester: '初二上',
                    tags: ['一元一次方程', '移项'], imageBase64: IMAGE, difficulty: 'medium', language: 'zh',
                }), 'practice-request-1');
            expect(mocks.mockAIService.generateSimilarQuestion).not.toHaveBeenCalled();
            expect(mocks.mockPrismaUser.findUnique).toHaveBeenCalledWith({
                where: { id: 'user-123' }, select: { id: true, role: true, isActive: true, expiresAt: true, sessionVersion: true, mustChangePassword: true, revision: true, aiAccessInitialized: true },
            });
        });

        it('错题查询限定owner，不采用客户端伪造的userId', async () => {
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1', userId: 'other-user' }))).status).toBe(202);
            expect(mocks.mockPrismaErrorItem.findFirst).toHaveBeenCalledExactlyOnceWith({
                where: { id: 'error-item-1', userId: 'user-123' }, include: { subject: true },
            });
            expect(mocks.mockPrismaErrorItem.findUnique).not.toHaveBeenCalled();
            const [owner, , input] = mocks.mockSubmitJob.mock.calls[0];
            expect(owner).toBe('user-123');
            expect(input).not.toHaveProperty('userId');
        });

        it('不存在或不属于用户的错题均返回404，不泄露题目', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            const response = await GENERATE_POST(generateRequest({ errorItemId: 'foreign-item' }));
            expect(response.status).toBe(404);
            expect(await response.json()).toEqual({ message: 'NOT_FOUND' });
            expect(mocks.mockSubmitJob).not.toHaveBeenCalled();
        });

        it.each([{}, { errorItemId: 123 }])('缺少或无效错题id返回400：%j', async (body) => {
            expect((await GENERATE_POST(generateRequest(body))).status).toBe(400);
            expect(mocks.mockPrismaErrorItem.findFirst).not.toHaveBeenCalled();
            expect(mocks.mockSubmitJob).not.toHaveBeenCalled();
        });

        it.each(['easy', 'medium', 'hard', 'harder'])('保留目标难度%s', async (difficulty) => {
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1', difficulty }))).status).toBe(202);
            expect(mocks.mockSubmitJob).toHaveBeenCalledWith('user-123', 'practice',
                expect.objectContaining({ difficulty }), 'practice-request-1');
        });

        it('保留英文与用户校正文本，使用错题保存的年级和知识点', async () => {
            const body = {
                errorItemId: 'error-item-1', language: 'en', questionText: 'Corrected question',
                gradeSemester: '高三', subject: '伪造学科', tags: ['伪造标签'],
            };
            expect((await GENERATE_POST(generateRequest(body))).status).toBe(202);
            expect(mocks.mockSubmitJob).toHaveBeenCalledWith('user-123', 'practice', expect.objectContaining({
                language: 'en', questionText: 'Corrected question', subject: '数学',
                gradeSemester: '初二上', tags: ['一元一次方程', '移项'],
            }), 'practice-request-1');
        });

        it('显式图片和原图保留，不能丢弃为纯文字任务', async () => {
            const image = 'data:image/jpeg;base64,BAUG';
            const body = { errorItemId: 'error-item-1', imageBase64: image, originalImageBase64: IMAGE };
            expect((await GENERATE_POST(generateRequest(body))).status).toBe(202);
            expect(mocks.mockSubmitJob).toHaveBeenCalledWith('user-123', 'practice',
                expect.objectContaining(body), 'practice-request-1');
        });

        it('原错题没有图片时可以提交纯文字练习', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue({ ...mockErrorItem, originalImageUrl: null });
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1', mode: 'text' }))).status).toBe(202);
            expect(mocks.mockSubmitJob.mock.calls[0][2].imageBase64).toBeUndefined();
        });

        it('已有几何图不能被mode=text静默丢弃', async () => {
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1', mode: 'text' }))).status).toBe(400);
            expect(mocks.mockSubmitJob).not.toHaveBeenCalled();
        });

        it.each(['invalid json', '', null])('损坏或空知识点回退为空标签：%j', async (knowledgePoints) => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue({ ...mockErrorItem, knowledgePoints });
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1' }))).status).toBe(202);
            expect(mocks.mockSubmitJob.mock.calls[0][2].tags).toEqual([]);
        });

        it('没有关联学科时不伪造学科名称', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue({ ...mockErrorItem, subject: null });
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1' }))).status).toBe(202);
            expect(mocks.mockSubmitJob.mock.calls[0][2].subject).toBeUndefined();
        });

        it('显式subjectId同样按用户权限校验', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ name: '物理' });
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1', subjectId: 'physics-1' }))).status).toBe(202);
            expect(mocks.mockPrismaSubject.findFirst).toHaveBeenCalledWith({ where: { id: 'physics-1', userId: 'user-123' } });
            expect(mocks.mockSubmitJob.mock.calls[0][2].subject).toBe('物理');
        });

        it('其他用户的学科不能被关联到任务', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1', subjectId: 'foreign-subject' }))).status).toBe(404);
            expect(mocks.mockSubmitJob).not.toHaveBeenCalled();
        });

        it('未登录返回401，不查询错题或入队', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1' }))).status).toBe(401);
            expect(mocks.mockPrismaErrorItem.findFirst).not.toHaveBeenCalled();
            expect(mocks.mockSubmitJob).not.toHaveBeenCalled();
        });

        it.each([null, { id: 'user-123', role: 'admin', isActive: false }])('实时停用/删除用户被拒绝：%j', async (user) => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue(user);
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1' }))).status).toBe(403);
            expect(mocks.mockPrismaErrorItem.findFirst).not.toHaveBeenCalled();
            expect(mocks.mockSubmitJob).not.toHaveBeenCalled();
        });

        it('跨站请求返回403', async () => {
            expect((await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1' }, { origin: 'https://untrusted.example' }))).status).toBe(403);
            expect(mocks.mockSubmitJob).not.toHaveBeenCalled();
        });

        it.each([['AI_QUEUE_FULL', 429], ['REQUEST_CONFLICT', 409]])('队列拒绝%s返回%d，而非同步AI错误', async (code, status) => {
            mocks.mockSubmitJob.mockRejectedValue(new Error(code));
            const response = await GENERATE_POST(generateRequest({ errorItemId: 'error-item-1' }));
            expect(response.status).toBe(status);
            expect(await response.json()).toEqual({ message: code });
        });
    });

    describe('POST /api/practice/record (记录练习结果)', () => {
        it('应该成功记录正确的练习结果', async () => {
            const createdRecord = {
                id: 'record-1',
                userId: 'user-123',
                subject: '数学',
                difficulty: 'medium',
                isCorrect: true,
                createdAt: new Date(),
            };
            mocks.mockPrismaPracticeRecord.create.mockResolvedValue(createdRecord);

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '数学',
                    difficulty: 'medium',
                    isCorrect: true,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subject).toBe('数学');
            expect(data.isCorrect).toBe(true);
        });

        it('应该成功记录错误的练习结果', async () => {
            const createdRecord = {
                id: 'record-2',
                userId: 'user-123',
                subject: '英语',
                difficulty: 'hard',
                isCorrect: false,
                createdAt: new Date(),
            };
            mocks.mockPrismaPracticeRecord.create.mockResolvedValue(createdRecord);

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '英语',
                    difficulty: 'hard',
                    isCorrect: false,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.isCorrect).toBe(false);
        });

        it('应该记录不同学科的练习结果', async () => {
            const subjects = ['数学', '物理', '化学', '英语', '语文'];

            for (const subject of subjects) {
                mocks.mockPrismaPracticeRecord.create.mockResolvedValue({
                    id: `record-${subject}`,
                    userId: 'user-123',
                    subject,
                    difficulty: 'medium',
                    isCorrect: true,
                });

                const request = new Request('http://localhost/api/practice/record', {
                    method: 'POST',
                    body: JSON.stringify({
                        subject,
                        difficulty: 'medium',
                        isCorrect: true,
                    }),
                    headers: { 'Content-Type': 'application/json' },
                });

                const response = await RECORD_POST(request);
                expect(response.status).toBe(200);
            }
        });

        it('应该拒绝未登录用户', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '数学',
                    difficulty: 'medium',
                    isCorrect: true,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('应该拒绝 session 中没有 user 的请求', async () => {
            vi.mocked(getServerSession).mockResolvedValue({
                user: undefined,
                expires: '2025-12-31',
            } as any);

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '数学',
                    difficulty: 'medium',
                    isCorrect: true,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaPracticeRecord.create.mockRejectedValue(
                new Error('Database connection failed')
            );

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '数学',
                    difficulty: 'medium',
                    isCorrect: true,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to save record');
        });
    });
});

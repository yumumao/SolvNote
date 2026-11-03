import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    session: vi.fn(), user: vi.fn(), subject: vi.fn(), recent: vi.fn(),
    createItem: vi.fn(), items: vi.fn(), item: vi.fn(), updateItem: vi.fn(), countItems: vi.fn(),
    tag: vi.fn(), tags: vi.fn(), createTag: vi.fn(),
    subjects: vi.fn(), schedules: vi.fn(), practice: vi.fn(), deleteSubject: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('@/lib/tag-recognition', () => ({ findParentTagIdForGrade: vi.fn() }));
vi.mock('@/lib/knowledge-tags', () => ({ inferSubjectFromName: () => null }));
vi.mock('@/lib/prisma', () => ({ prisma: {
    user: { findUnique: mocks.user },
    subject: { findUnique: mocks.subject, findMany: mocks.subjects, delete: mocks.deleteSubject },
    errorItem: { findFirst: mocks.recent, create: mocks.createItem, findMany: mocks.items, findUnique: mocks.item, update: mocks.updateItem, count: mocks.countItems },
    knowledgeTag: { findFirst: mocks.tag, findMany: mocks.tags, create: mocks.createTag },
    reviewSchedule: { findMany: mocks.schedules },
    practiceRecord: { findMany: mocks.practice },
} }));

import { POST as createItem } from '@/app/api/error-items/route';
import { PATCH as updateNotes } from '@/app/api/error-items/[id]/notes/route';
import { GET as tagStats } from '@/app/api/tags/stats/route';
import { POST as createTag } from '@/app/api/tags/route';
import { GET as tagSuggestions } from '@/app/api/tags/suggestions/route';
import { GET as getItem } from '@/app/api/error-items/[id]/route';
import { GET as listItems } from '@/app/api/error-items/list/route';
import { GET as analytics } from '@/app/api/analytics/route';
import { GET as exportData } from '@/app/api/export/route';
import { GET as notebooks } from '@/app/api/notebooks/route';
import { DELETE as deleteNotebook } from '@/app/api/notebooks/[id]/route';

const actor = { id: 'trial-user', email: 'trial@example.invalid', role: 'user', isActive: true, expiresAt: new Date('2099-01-01'), sessionVersion: 0 };
const privateMarker = 'SYNTHETIC_OTHER_USER_PRIVATE_CONTENT';
function request(path: string, body?: unknown, method = 'POST') {
    return new NextRequest(`https://synthetic.invalid/api/${path}`, body === undefined ? undefined : {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
}
function itemRequest(subjectId?: string) {
    return request('error-items', { subjectId, questionText: 'Synthetic question', originalImageUrl: '', knowledgePoints: [] });
}

beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: actor });
    mocks.user.mockResolvedValue(actor);
    mocks.recent.mockResolvedValue(null);
    mocks.countItems.mockResolvedValue(1);
    mocks.subject.mockResolvedValue({ id: 'notebook', name: 'Synthetic notebook', userId: 'other-user' });
    mocks.createItem.mockImplementation(async ({ data }) => ({ id: 'created-item', ...data, tags: [] }));
    mocks.items.mockImplementation(async (args) => args?.where?.userId === actor.id
        ? [{ knowledgePoints: '["own-tag"]' }]
        : [{ knowledgePoints: '["own-tag"]' }, { knowledgePoints: JSON.stringify([privateMarker]) }]);
    mocks.item.mockResolvedValue({ id: 'item', userId: 'other-user' });
    mocks.updateItem.mockResolvedValue({ id: 'item', userId: 'other-user', questionText: privateMarker });
    mocks.tag.mockResolvedValue(null);
    mocks.createTag.mockImplementation(async ({ data }) => ({ id: 'created-tag', ...data }));
    mocks.subjects.mockResolvedValue([]);
    mocks.schedules.mockResolvedValue([]);
    mocks.practice.mockResolvedValue([]);
    mocks.tags.mockResolvedValue([]);
});

describe('trial account privacy boundaries', () => {
    it('rejects a foreign notebook before creating an item or tag', async () => {
        const response = await createItem(itemRequest('notebook'));
        expect(response.status).toBe(403);
        expect(mocks.createItem).not.toHaveBeenCalled();
        expect(mocks.createTag).not.toHaveBeenCalled();
    });
    it('rejects a nonexistent notebook without writes', async () => {
        mocks.subject.mockResolvedValue(null);
        expect((await createItem(itemRequest('missing'))).status).toBe(403);
        expect(mocks.createItem).not.toHaveBeenCalled();
    });
    it('allows an owned notebook', async () => {
        mocks.subject.mockResolvedValue({ id: 'notebook', name: 'Synthetic notebook', userId: actor.id });
        const response = await createItem(itemRequest('notebook'));
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ userId: actor.id, subjectId: 'notebook' });
    });
    it('allows an item without a notebook', async () => {
        expect((await createItem(itemRequest())).status).toBe(201);
    });
    it('does not disclose another accounts tag text or counts', async () => {
        const response = await tagStats(request('tags/stats'));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ stats: [{ tag: 'own-tag', count: 1 }], total: 1, uniqueTags: 1 });
        expect(response.headers.get('Cache-Control')).toBe('no-store');
    });
    it('rejects anonymous tag statistics before reading data', async () => {
        mocks.session.mockResolvedValue(null);
        expect((await tagStats(request('tags/stats'))).status).toBe(401);
        expect(mocks.items).not.toHaveBeenCalled();
    });
    it.each([
        { expiresAt: new Date('2000-01-01') }, { isActive: false },
        { sessionVersion: 1 }, { mustChangePassword: true },
    ])('rejects unavailable or revoked accounts before reading tags: %j', async (change) => {
        mocks.user.mockResolvedValue({ ...actor, ...change });
        expect((await tagStats(request('tags/stats'))).status).toBe(403);
        expect(mocks.items).not.toHaveBeenCalled();
    });
    it('does not overwrite or return another accounts item through notes', async () => {
        const response = await updateNotes(request('error-items/item/notes', { userNotes: 'Synthetic note' }, 'PATCH'), { params: Promise.resolve({ id: 'item' }) });
        expect(response.status).toBe(403);
        expect(mocks.updateItem).not.toHaveBeenCalled();
        expect(await response.text()).not.toContain(privateMarker);
    });
    it('does not write notes to a nonexistent item', async () => {
        mocks.item.mockResolvedValue(null);
        const response = await updateNotes(request('error-items/missing/notes', { userNotes: 'Synthetic note' }, 'PATCH'), { params: Promise.resolve({ id: 'missing' }) });
        expect(response.status).toBe(404);
        expect(mocks.updateItem).not.toHaveBeenCalled();
    });
    it('allows the owner to update notes with an owner-scoped write', async () => {
        mocks.item.mockResolvedValue({ id: 'item', userId: actor.id });
        mocks.updateItem.mockResolvedValue({ id: 'item', userId: actor.id, userNotes: 'Synthetic note' });
        const response = await updateNotes(request('error-items/item/notes', { userNotes: 'Synthetic note' }, 'PATCH'), { params: Promise.resolve({ id: 'item' }) });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ userId: actor.id, userNotes: 'Synthetic note' });
        expect(mocks.updateItem).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'item', userId: actor.id } }));
    });
    it('rejects a foreign private parent tag before creating any relation', async () => {
        const response = await createTag(request('tags', { name: 'Synthetic child', subject: 'math', parentId: 'foreign-parent' }));
        expect(response.status).toBe(403);
        expect(mocks.createTag).not.toHaveBeenCalled();
    });
    it.each([true, false])('allows an accessible parent tag (system=%s)', async (isSystem) => {
        mocks.tag.mockImplementation(async ({ where }) => where.id ? { id: 'parent', subject: 'math', isSystem, userId: isSystem ? null : actor.id } : null);
        const response = await createTag(request('tags', { name: 'Synthetic child', subject: 'math', parentId: 'parent' }));
        expect(response.status).toBe(201);
        expect(mocks.tag).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'parent', subject: 'math', OR: [{ isSystem: true }, { userId: actor.id }] } }));
    });
    it('allows a custom root tag', async () => {
        expect((await createTag(request('tags', { name: 'Synthetic root', subject: 'math' }))).status).toBe(201);
    });
    it('does not let another accounts private children hide a shared tag suggestion', async () => {
        mocks.tags.mockImplementation(async (args) => [{
            id: 'system-tag', name: 'Shared synthetic tag', isSystem: true, parentId: null,
            children: args?.select?.children?.where?.OR ? [] : [{ id: 'foreign-private-child' }],
        }]);
        const response = await tagSuggestions(request('tags/suggestions'));
        expect(await response.json()).toEqual({ suggestions: ['Shared synthetic tag'], total: 1 });
    });

    it('hides a legacy foreign notebook association when reading an owned item', async () => {
        mocks.item.mockImplementation(async (args) => ({
            id: 'item', userId: actor.id,
            subject: args?.include?.subject?.where?.userId === actor.id ? null : { id: 'foreign', userId: 'other-user', name: privateMarker },
        }));
        const response = await getItem(request('error-items/item'), { params: Promise.resolve({ id: 'item' }) });
        expect(response.status).toBe(200);
        expect(await response.text()).not.toContain(privateMarker);
    });
    it.each([
        { name: 'item list', call: () => listItems(request('error-items/list')) },
        { name: 'analytics', call: () => analytics(request('analytics')) },
    ])('hides a legacy foreign notebook association in $name', async ({ call }) => {
        mocks.items.mockImplementation(async (args) => [{
            id: 'item', userId: actor.id,
            subject: args?.include?.subject?.where?.userId === actor.id ? null : { id: 'foreign', userId: 'other-user', name: privateMarker },
        }]);
        const response = await call();
        expect(response.status).toBe(200);
        expect(await response.text()).not.toContain(privateMarker);
    });
    it('exports only accessible related tags and excludes credential fields', async () => {
        mocks.user.mockResolvedValue({ ...actor, password: 'SYNTHETIC_CREDENTIAL_NOT_FOR_EXPORT', apiKey: 'SYNTHETIC_CREDENTIAL_NOT_FOR_EXPORT' });
        mocks.items.mockImplementation(async (args) => [{
            id: 'item', userId: actor.id,
            tags: args?.include?.tags?.where?.OR ? [] : [{ id: 'foreign-tag', name: privateMarker, userId: 'other-user' }],
        }]);
        const response = await exportData(request('export'));
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain(privateMarker);
        expect(text).not.toContain('SYNTHETIC_CREDENTIAL_NOT_FOR_EXPORT');
    });
    it('denies a trial account an all-user export before reading user data', async () => {
        expect((await exportData(request('export?all=true'))).status).toBe(403);
        expect(mocks.items).not.toHaveBeenCalled();
    });
    it('does not count a legacy foreign item inside an owned notebook', async () => {
        mocks.subjects.mockImplementation(async (args) => [{
            id: 'notebook', userId: actor.id,
            _count: { errorItems: args?.include?._count?.select?.errorItems?.where?.userId === actor.id ? 1 : 7 },
        }]);
        const response = await notebooks();
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject([{ _count: { errorItems: 1 } }]);
    });
    it('blocks notebook deletion when it would cascade to a legacy foreign item', async () => {
        mocks.subject.mockImplementation(async (args) => ({
            id: 'notebook', userId: actor.id,
            _count: { errorItems: args?.include?._count?.select?.errorItems?.where?.userId === actor.id ? 0 : 1 },
        }));
        const response = await deleteNotebook(request('notebooks/notebook', {}, 'DELETE'), { params: Promise.resolve({ id: 'notebook' }) });
        expect(response.status).toBe(400);
        expect(mocks.deleteSubject).not.toHaveBeenCalled();
    });
});

import {Prisma} from "@prisma/client";
import {prisma} from "@/lib/prisma";
import {AIRequestError} from "@/lib/ai-access";
import {announcementInput, statuses, type NoticeView} from "./schema";

export function parsePage(params: URLSearchParams): number {
    const p = params.get("page") ?? "1";
    if (!/^[1-9]\d{0,5}$/.test(p)) throw new AIRequestError(400, "Invalid page");
    return Number(p);
}
function visible(now: Date): Prisma.AnnouncementWhereInput {
    return {status: "published", AND: [
        {OR: [{startsAt: null}, {startsAt: {lte: now}}]},
        {OR: [{endsAt: null}, {endsAt: {gt: now}}]},
    ]};
}
const orderBy: Prisma.AnnouncementOrderByWithRelationInput[] = [
    {pinned: "desc"}, {pinOrder: "asc"}, {createdAt: "desc"}, {id: "asc"},
];
export async function listNotices(userId: string, view: NoticeView, page: number, now = new Date()) {
    const unread = {reads: {none: {userId}}};
    const audience: Prisma.AnnouncementWhereInput = view === "history"
        ? {readPolicy: "keep", reads: {some: {userId}}}
        : {OR: [unread, {readPolicy: "persistent"}]};
    const where = {AND: [visible(now), audience]};
    return prisma.$transaction(async db => {
        const [items, total, unreadCount] = await Promise.all([
            db.announcement.findMany({where, orderBy, skip: (page - 1) * 20, take: 20,
                include: {reads: {where: {userId}, select: {readAt: true}}}}),
            db.announcement.count({where}), db.announcement.count({where: {AND: [visible(now), unread]}}),
        ]);
        return {items: items.map(({reads, ...notice}) => ({...notice, readAt: reads[0]?.readAt ?? null})), total, unreadCount, page, pageSize: 20};
    });
}
export async function acknowledgeNotice(userId: string, id: string, now = new Date()) {
    return prisma.$transaction(async db => {
        const item = await db.announcement.findFirst({where: {AND: [{id}, visible(now)]}, select: {id: true}});
        if (!item) throw new AIRequestError(404, "Notice unavailable");
        const read = await db.announcementRead.upsert({where: {announcementId_userId: {announcementId: id, userId}},
            create: {announcementId: id, userId, readAt: now}, update: {}, select: {readAt: true}});
        return {readAt: read.readAt};
    });
}
export async function listAdminNotices(params: URLSearchParams) {
    const page = parsePage(params), status = params.get("status") ?? "all";
    if (status !== "all" && !statuses.some(s => s === status)) throw new AIRequestError(400, "Invalid status");
    const where = status === "all" ? {} : {status};
    const [items, total] = await prisma.$transaction([
        prisma.announcement.findMany({where, orderBy, skip: (page - 1) * 20, take: 20}),
        prisma.announcement.count({where}),
    ]);
    return {items, total, page, pageSize: 20};
}
const quickActions = ["pin", "unpin", "hide", "publish"] as const;
type QuickAction = typeof quickActions[number];

async function updateNoticeWithRevision(id: string, revision: number, data: Prisma.AnnouncementUpdateManyMutationInput) {
    return prisma.$transaction(async db => {
        const result = await db.announcement.updateMany({where: {id, revision}, data: {...data, revision: {increment: 1}}});
        if (!result.count) {
            const exists = await db.announcement.findUnique({where: {id}, select: {id: true}});
            throw new AIRequestError(exists ? 409 : 404, exists ? "Notice changed; reload before updating" : "Notice unavailable");
        }
        return db.announcement.findUniqueOrThrow({where: {id}});
    });
}

export async function updateNoticeAction(raw: unknown, id: string) {
    const envelope = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const {revision, action, ...extra} = envelope;
    if (Object.keys(extra).length || typeof revision !== "number" || !Number.isInteger(revision) || revision < 1 ||
        typeof action !== "string" || !quickActions.includes(action as QuickAction))
        throw new AIRequestError(400, "Invalid notice action");
    const data: Prisma.AnnouncementUpdateManyMutationInput = action === "pin" ? {pinned: true} :
        action === "unpin" ? {pinned: false, pinOrder: 0} :
        {status: action === "hide" ? "hidden" : "published"};
    return updateNoticeWithRevision(id, revision, data);
}

export async function deleteNotice(raw: unknown, id: string) {
    const envelope = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const {revision, ...extra} = envelope;
    if (Object.keys(extra).length || typeof revision !== "number" || !Number.isInteger(revision) || revision < 1)
        throw new AIRequestError(400, "Revision required");
    return prisma.$transaction(async db => {
        const result = await db.announcement.deleteMany({where: {id, revision}});
        if (!result.count) {
            const exists = await db.announcement.findUnique({where: {id}, select: {id: true}});
            throw new AIRequestError(exists ? 409 : 404, exists ? "Notice changed; reload before deleting" : "Notice unavailable");
        }
        return {id, deleted: true};
    });
}

export async function saveNotice(raw: unknown, id?: string) {
    const envelope = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const {revision, ...fields} = envelope;
    if (!id && revision !== undefined) throw new AIRequestError(400, "Invalid input");
    if (id && (!Number.isInteger(revision) || Number(revision) < 1)) throw new AIRequestError(400, "Revision required");
    const parsed = announcementInput.safeParse(fields);
    if (!parsed.success) throw new AIRequestError(400, "Invalid announcement");
    const value = parsed.data;
    const data = {...value, pinOrder: value.pinned ? value.pinOrder : 0,
        startsAt: value.startsAt ? new Date(value.startsAt) : null, endsAt: value.endsAt ? new Date(value.endsAt) : null};
    if (!id) return prisma.announcement.create({data});
    return updateNoticeWithRevision(id, Number(revision), data);
}

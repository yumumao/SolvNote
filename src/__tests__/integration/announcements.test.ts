// @vitest-environment node
import {beforeAll, beforeEach, afterAll, describe, it, expect, vi} from "vitest";
import {mkdtempSync, mkdirSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {PrismaClient} from "@prisma/client";
const shared = vi.hoisted(() => ({db: null as unknown as PrismaClient, user: "alice" as string | null}));
vi.mock("@/lib/prisma", () => ({get prisma() {return shared.db;}}));
vi.mock("@/lib/auth", () => ({authOptions: {}}));
vi.mock("next-auth", () => ({getServerSession: async () => shared.user ? {user: {id: shared.user, role: "admin"}} : null}));
import {GET, POST} from "@/app/api/admin/announcements/route";
import {DELETE, PATCH, PUT} from "@/app/api/admin/announcements/[id]/route";
import {GET as userGET} from "@/app/api/announcements/route";
import {POST as readPOST} from "@/app/api/announcements/[id]/read/route";
import {saveNotice, listNotices, acknowledgeNotice} from "@/lib/announcements/store";
const base = {titleZh: "合成公告", bodyZh: "仅测试纯文本", titleEn: "Synthetic notice", bodyEn: "Text only", href: "/stats", status: "published", pinned: false, pinOrder: 0, readPolicy: "keep", startsAt: null, endsAt: null};
const req = (url: string, body?: unknown, origin?: string, method = body === undefined ? "GET" : "POST") => new Request("http://localhost" + url, body === undefined ? {method} : {method, headers: {"Content-Type": "application/json", ...(origin ? {Origin: origin} : {})}, body: JSON.stringify(body)});
const ctx = (id: string) => ({params: Promise.resolve({id})});
let url: string;
beforeAll(async () => {
    mkdirSync(".codex/tmp", {recursive: true});
    const dir = mkdtempSync(path.resolve(".codex/tmp/notices-db-")); url = "file:" + path.join(dir, "fixture.db").replaceAll("\\", "/");
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {env: {...process.env, DATABASE_URL: url}, windowsHide: true, stdio: "pipe"});
    shared.db = new PrismaClient({datasources: {db: {url}}});
    for (const id of ["alice", "bob", "admin"]) await shared.db.user.create({data: {id, email: id + "@example.invalid", password: "unused", role: id === "admin" ? "admin" : "user"}});
}, 30000);
beforeEach(async () => {shared.user = "admin"; await shared.db.announcement.deleteMany();});
afterAll(async () => {await shared.db?.$disconnect();});
describe.sequential("account-specific notices on disposable SQLite", () => {
    it("requires current active admin role, not a stale JWT, for admin endpoints", async () => {
        shared.user = null; expect((await GET(req("/api/admin/announcements"))).status).toBe(401);
        shared.user = "alice"; expect((await POST(req("/api/admin/announcements", base))).status).toBe(403);
        shared.user = "admin"; await shared.db.user.update({where: {id: "admin"}, data: {isActive: false}});
        try {expect((await GET(req("/api/admin/announcements"))).status).toBe(403);} finally {await shared.db.user.update({where: {id: "admin"}, data: {isActive: true}});}
        const res = await POST(req("/api/admin/announcements", base)); expect(res.status).toBe(201); expect(res.headers.get("cache-control")).toBe("no-store");
    });
    it("hides only from the reader, persists across clients, and acknowledges idempotently", async () => {
        const n = await saveNotice({...base, readPolicy: "hide"}); shared.user = "alice";
        expect((await (await userGET(req("/api/announcements"))).json()).unreadCount).toBe(1);
        expect(await shared.db.announcementRead.count()).toBe(0); // GET is not acknowledgement
        const one = await (await readPOST(req("/api/announcements/" + n.id + "/read", {userId: "bob"}), ctx(n.id))).json();
        const two = await (await readPOST(req("/api/announcements/" + n.id + "/read", {}), ctx(n.id))).json();
        expect(one).toEqual(two); expect(await shared.db.announcementRead.count()).toBe(1);
        expect((await listNotices("alice", "inbox", 1)).items).toHaveLength(0);
        expect((await listNotices("alice", "history", 1)).items).toHaveLength(0);
        expect((await listNotices("bob", "inbox", 1)).items).toHaveLength(1);
        const other = new PrismaClient({datasources: {db: {url}}});
        try {expect(await other.announcementRead.count({where: {userId: "alice"}})).toBe(1);expect(await other.announcement.count()).toBe(1);} finally {await other.$disconnect();}
        shared.user = "admin";expect((await (await GET(req("/api/admin/announcements"))).json()).items).toHaveLength(1);
    });
    it("moves ordinary notices to history, keeps persistent notices, and separates unread counts", async () => {
        const keep = await saveNotice(base), stay = await saveNotice({...base, readPolicy: "persistent"});
        await acknowledgeNotice("alice", keep.id); await acknowledgeNotice("alice", stay.id);
        const inbox = await listNotices("alice", "inbox", 1), history = await listNotices("alice", "history", 1);
        expect(inbox.items.map(n => n.id)).toEqual([stay.id]);expect(inbox.unreadCount).toBe(0);
        expect(history.items.map(n => n.id)).toEqual([keep.id]);expect((await listNotices("bob", "inbox", 1)).unreadCount).toBe(2);
        expect(JSON.stringify(inbox)).not.toContain('"userId"');expect(JSON.stringify(inbox)).not.toContain('"reads"');
    });
    it("filters draft, hidden, archived, future and expired even for direct acknowledgement", async () => {
        const now = new Date("2026-09-26T08:00:00Z");
        for (const changes of [{status: "draft"}, {status: "hidden"}, {status: "archived"}, {startsAt: "2026-09-27T00:00:00Z"}, {endsAt: now.toISOString()}]) {
            const item = await saveNotice({...base, ...changes});
            await expect(acknowledgeNotice("alice", item.id, now)).rejects.toMatchObject({status: 404});
        }
        const live = await saveNotice({...base, startsAt: now.toISOString()});
        expect((await listNotices("alice", "inbox", 1, now)).items.map(n => n.id)).toEqual([live.id]);
    });
    it("rejects invalid input and cross-origin writes without returning internal errors", async () => {
        for (const href of ["https://evil.invalid", "//evil.invalid", "/%2fevil.invalid", "/%5cevil", "/x%0a", "javascript:alert(1)"]) {
            expect((await POST(req("/api/admin/announcements", {...base, href}))).status).toBe(400);
        }
        for (const changes of [{titleZh: " "}, {bodyZh: "x".repeat(6001)}, {pinOrder: -1}, {status: "__proto__"}, {readPolicy: "delete"}, {startsAt: "bad"}, {startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-09-01T00:00:00Z"}, {userId: "bob"}])
            expect((await POST(req("/api/admin/announcements", {...base, ...changes}))).status).toBe(400);
        expect((await POST(req("/api/admin/announcements", base, "https://evil.invalid"))).status).toBe(403);
        const n = await saveNotice(base);expect((await readPOST(req("/api/announcements/x/read", {}, "https://evil.invalid"), ctx(n.id))).status).toBe(403);
        expect((await POST(new Request("http://localhost/api/admin/announcements", {method: "POST", headers: {"content-type": "application/json"}, body: "x".repeat(65537)}))).status).toBe(413);
        expect((await POST(new Request("http://localhost/api/admin/announcements", {method: "POST", body: "{}"}))).status).toBe(415);
        expect((await userGET(req("/api/announcements?page=0"))).status).toBe(400);
        expect((await userGET(req("/api/announcements?view=all"))).status).toBe(400);
    });
    it("supports direct pin/hide/republish actions and guarded permanent deletion", async () => {
        const n = await saveNotice(base);
        let response = await PATCH(req(`/api/admin/announcements/${n.id}`, {action: "pin", revision: n.revision}, undefined, "PATCH"), ctx(n.id));
        expect(response.status).toBe(200); let updated = await response.json(); expect(updated.pinned).toBe(true);
        response = await PATCH(req(`/api/admin/announcements/${n.id}`, {action: "hide", revision: updated.revision}, undefined, "PATCH"), ctx(n.id));
        expect(response.status).toBe(200); updated = await response.json(); expect(updated.status).toBe("hidden");
        response = await PATCH(req(`/api/admin/announcements/${n.id}`, {action: "publish", revision: updated.revision}, undefined, "PATCH"), ctx(n.id));
        expect(response.status).toBe(200); updated = await response.json(); expect(updated.status).toBe("published");
        await acknowledgeNotice("alice", n.id);
        expect((await DELETE(req(`/api/admin/announcements/${n.id}`, {revision: n.revision}, undefined, "DELETE"), ctx(n.id))).status).toBe(409);
        response = await DELETE(req(`/api/admin/announcements/${n.id}`, {revision: updated.revision}, undefined, "DELETE"), ctx(n.id));
        expect(response.status).toBe(200); expect(await response.json()).toEqual({id: n.id, deleted: true});
        expect(await shared.db.announcement.count()).toBe(0); expect(await shared.db.announcementRead.count()).toBe(0);
    });
    it.each(["PATCH", "DELETE"] as const)("guards %s with live admin role, origin and request validation", async method => {
        const n = await saveNotice(base);
        const handler = method === "PATCH" ? PATCH : DELETE;
        const payload = method === "PATCH" ? {action: "pin", revision: n.revision} : {revision: n.revision};
        const call = (body: unknown = payload, origin?: string, id = n.id) => handler(req(`/api/admin/announcements/${id}`, body, origin, method), ctx(id));
        shared.user = null; expect((await call()).status).toBe(401);
        for (const id of ["alice", "missing"]) {shared.user = id; expect((await call()).status).toBe(403);}
        shared.user = "admin"; await shared.db.user.update({where: {id: "admin"}, data: {isActive: false}});
        try {expect((await call()).status).toBe(403);} finally {await shared.db.user.update({where: {id: "admin"}, data: {isActive: true}});}
        expect((await call(payload, "https://evil.invalid")).status).toBe(403);
        for (const body of [null, [], {}, {...payload, revision: 0}, {...payload, revision: 1.5}, {...payload, revision: "1"}, {...payload, userId: "alice"}])
            expect((await call(body)).status).toBe(400);
        expect((await call(payload, undefined, "bad/id")).status).toBe(400);
        expect((await call(payload, undefined, "absent")).status).toBe(404);
        const wrongType = new Request(`http://localhost/api/admin/announcements/${n.id}`, {method, body: "{}"});
        expect((await handler(wrongType, ctx(n.id))).status).toBe(415);
        const large = new Request(`http://localhost/api/admin/announcements/${n.id}`, {method, headers: {"Content-Type": "application/json"}, body: "x".repeat(8193)});
        expect((await handler(large, ctx(n.id))).status).toBe(413);
        if (method === "PATCH") expect((await call({...payload, action: "delete"})).status).toBe(400);
        expect((await shared.db.announcement.findUniqueOrThrow({where: {id: n.id}})).revision).toBe(n.revision);
    });
    it("keeps content, schedule and receipts through quick actions, rejects stale changes", async () => {
        const n = await saveNotice({...base, pinned: true, pinOrder: 6, startsAt: "2026-01-01T00:00:00Z", endsAt: "2030-01-01T00:00:00Z"});
        await acknowledgeNotice("alice", n.id);
        const before = await shared.db.announcementRead.findMany();
        let revision = n.revision;
        for (const action of ["unpin", "pin", "hide", "publish"]) {
            const response = await PATCH(req(`/api/admin/announcements/${n.id}`, {action, revision}, undefined, "PATCH"), ctx(n.id));
            expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
            const updated = await response.json(); expect(updated.revision).toBe(revision + 1); revision = updated.revision;
            expect(updated.titleZh).toBe(n.titleZh); expect(updated.bodyZh).toBe(n.bodyZh); expect(updated.readPolicy).toBe(n.readPolicy);
            expect(updated.startsAt).toBe(n.startsAt!.toISOString()); expect(updated.endsAt).toBe(n.endsAt!.toISOString());
            if (action === "unpin") {expect(updated.pinned).toBe(false); expect(updated.pinOrder).toBe(0);}
            expect(await shared.db.announcementRead.findMany()).toEqual(before);
            expect((await PATCH(req(`/api/admin/announcements/${n.id}`, {action, revision: n.revision}, undefined, "PATCH"), ctx(n.id))).status).toBe(409);
        }
        expect((await listNotices("alice", "history", 1)).total).toBe(1);
        expect((await listNotices("alice", "inbox", 1)).unreadCount).toBe(0);
        expect((await listNotices("bob", "inbox", 1)).unreadCount).toBe(1);
    });
    it("deletes only the chosen notice and its receipts, not other notices or accounts", async () => {
        const target = await saveNotice(base), other = await saveNotice({...base, titleZh: "保留的合成公告"});
        for (const id of ["alice", "bob"]) {await acknowledgeNotice(id, target.id); await acknowledgeNotice(id, other.id);}
        const users = await shared.db.user.count();
        const kept = await shared.db.announcementRead.findMany({where: {announcementId: other.id}});
        const response = await DELETE(req(`/api/admin/announcements/${target.id}`, {revision: target.revision}, undefined, "DELETE"), ctx(target.id));
        expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await shared.db.announcement.findUnique({where: {id: target.id}})).toBeNull();
        expect(await shared.db.announcementRead.count({where: {announcementId: target.id}})).toBe(0);
        expect(await shared.db.announcement.findUnique({where: {id: other.id}})).toEqual(other);
        expect(await shared.db.announcementRead.findMany({where: {announcementId: other.id}})).toEqual(kept);
        expect(await shared.db.user.count()).toBe(users);
        expect((await DELETE(req(`/api/admin/announcements/${target.id}`, {revision: target.revision}, undefined, "DELETE"), ctx(target.id))).status).toBe(404);
        expect((await PUT(req(`/api/admin/announcements/${target.id}`, {...base, revision: target.revision}), ctx(target.id))).status).toBe(404);
        await expect(acknowledgeNotice("alice", target.id)).rejects.toMatchObject({status: 404});
        expect((await listNotices("alice", "history", 1)).items.map(i => i.id)).toEqual([other.id]);
    });
    it("prevents lost updates and preserves read state across hide/republish and content edits", async () => {
        const n = await saveNotice(base);await acknowledgeNotice("alice", n.id);
        const hidden = await saveNotice({...base, status: "hidden", revision: n.revision}, n.id);
        expect((await listNotices("alice", "history", 1)).total).toBe(0);
        expect((await PUT(req("/api/admin/announcements/x", {...base, revision: n.revision}), ctx(n.id))).status).toBe(409);
        await saveNotice({...base, titleZh: "编辑不重发", revision: hidden.revision}, n.id);
        expect((await listNotices("alice", "history", 1)).total).toBe(1);
        expect((await listNotices("alice", "inbox", 1)).unreadCount).toBe(0);
        shared.user = "bob";expect((await PUT(req("/api/admin/announcements/x", {...base, revision: 3}), ctx(n.id))).status).toBe(403);
    });
    it("orders pins and pages all notices without a first-page unread limit", async () => {
        for (let i = 0; i < 23; i++) await saveNotice({...base, titleZh: "条目" + i, pinned: i < 3, pinOrder: i < 3 ? i : 0});
        const first = await listNotices("alice", "inbox", 1), second = await listNotices("alice", "inbox", 2);
        expect(first.items.slice(0, 3).map(n => n.titleZh)).toEqual(["条目0", "条目1", "条目2"]);
        expect(first.items).toHaveLength(20); expect(second.items).toHaveLength(3);expect(first.unreadCount).toBe(23);
        expect(new Set([...first.items, ...second.items].map(n => n.id)).size).toBe(23);
    });
    it("denies suspended/deleted accounts and does not leak unavailable announcement content", async () => {
        shared.user = "missing";expect((await userGET(req("/api/announcements"))).status).toBe(403);
        shared.user = null;expect((await readPOST(req("/api/announcements/x/read", {}), ctx("absent"))).status).toBe(401);
        shared.user = "alice";expect((await readPOST(req("/api/announcements/x/read", {}), ctx("absent"))).status).toBe(404);
    });
});

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import AdminAnnouncementsPage from "@/app/admin/announcements/page";
import {ApiError} from "@/lib/api-client";
import type {Announcement, AnnouncementList} from "@/lib/announcements/schema";
const mocks = vi.hoisted(() => ({get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), remove: vi.fn(), lang: "zh", role: "admin"}));
vi.mock("@/lib/api-client", async () => {
    const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
    return {...actual, apiClient: {get: mocks.get, post: mocks.post, put: mocks.put, patch: mocks.patch, delete: mocks.remove}};
});
vi.mock("@/contexts/LanguageContext", () => ({useLanguage: () => ({language: mocks.lang})}));
vi.mock("next-auth/react", () => ({useSession: () => ({data: {user: {id: "synthetic-admin", role: mocks.role}}, status: "authenticated"})}));
const item: Announcement = {id: "one", titleZh: "合成快捷公告", bodyZh: "仅测试文字", titleEn: "Synthetic quick notice", bodyEn: "Text only", href: "", readPolicy: "keep", status: "published", pinned: false, pinOrder: 0, startsAt: null, endsAt: null, revision: 3, createdAt: "", updatedAt: ""};
const list = (items: Announcement[] = [item], total = items.length, page = 1): AnnouncementList => ({items, total, page, pageSize: 20});
let host: HTMLDivElement, root: Root;
beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    for (const method of [mocks.get, mocks.post, mocks.put, mocks.patch, mocks.remove]) method.mockReset();
    mocks.get.mockResolvedValue(list()); mocks.patch.mockResolvedValue({}); mocks.remove.mockResolvedValue({}); mocks.lang = "zh"; mocks.role = "admin";
    vi.spyOn(window, "confirm").mockReturnValue(false);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
const button = (text: string) => {const found = [...host.querySelectorAll("button")].find(b => b.textContent === text); expect(found).toBeDefined(); return found!;};
const render = () => act(async () => root.render(<AdminAnnouncementsPage/>));
const click = (text: string) => act(async () => button(text).click());
async function select(value: string) {
    await act(async () => {const el = host.querySelector<HTMLSelectElement>('select[aria-label="状态筛选"]')!; el.value = value; el.dispatchEvent(new Event("change", {bubbles: true}));});
}
describe("admin announcement quick actions", () => {
    it("pins and unpins without opening the editor or sending stale content", async () => {
        await render(); mocks.get.mockResolvedValue(list([{...item, pinned: true, revision: 4}])); await click("置顶");
        expect(mocks.patch).toHaveBeenLastCalledWith("/api/admin/announcements/one", {action: "pin", revision: 3});
        expect(host.querySelector('section[aria-label="公告编辑"]')).toBeNull();
        mocks.get.mockResolvedValue(list([{...item, revision: 5}])); await click("取消置顶");
        expect(mocks.patch).toHaveBeenLastCalledWith("/api/admin/announcements/one", {action: "unpin", revision: 4});
        expect(mocks.put).not.toHaveBeenCalled();
    });
    it("hides and republishes with latest revisions and no implicit reads", async () => {
        await render(); mocks.get.mockResolvedValue(list([{...item, status: "hidden", revision: 4}])); await click("隐藏");
        expect(mocks.patch).toHaveBeenLastCalledWith("/api/admin/announcements/one", {action: "hide", revision: 3});
        mocks.get.mockResolvedValue(list([{...item, revision: 5}])); await click("恢复发布");
        expect(mocks.patch).toHaveBeenLastCalledWith("/api/admin/announcements/one", {action: "publish", revision: 4});
        expect(mocks.post).not.toHaveBeenCalled();
    });
    it("identifies the notice and irreversible receipt deletion before confirming", async () => {
        await render(); await click("删除");
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(item.titleZh));
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("已阅记录"));
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("无法撤销"));
        expect(mocks.remove).not.toHaveBeenCalled(); expect(host.textContent).toContain(item.titleZh);
        vi.mocked(window.confirm).mockReturnValue(true); mocks.get.mockResolvedValue(list([])); await click("删除");
        expect(mocks.remove).toHaveBeenCalledWith("/api/admin/announcements/one", {body: JSON.stringify({revision: 3})});
        expect(host.textContent).not.toContain(item.titleZh); expect(host.textContent).toContain("已永久删除");
    });
    it("disables filter and all mutations during a pending action", async () => {
        let finish!: (value: object) => void; mocks.patch.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        await render(); await click("置顶");
        expect(host.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
        for (const name of ["编辑", "删除", "隐藏", "新增公告", "刷新列表", "置顶"]) expect(button(name).disabled).toBe(true);
        await click("置顶"); expect(mocks.patch).toHaveBeenCalledTimes(1);
        await act(async () => finish({})); expect(button("置顶").disabled).toBe(false);
    });
    it("keeps the notice after delete conflict, refreshes explicitly and retries at the new revision", async () => {
        await render(); vi.mocked(window.confirm).mockReturnValue(true);
        mocks.remove.mockRejectedValueOnce(new ApiError(409, "Conflict", {})); await click("删除");
        expect(host.querySelector('[role="alert"]')!.textContent).toContain("刷新"); expect(host.textContent).toContain(item.titleZh);
        expect(mocks.get).toHaveBeenCalledTimes(1); expect(mocks.remove).toHaveBeenCalledTimes(1);
        mocks.get.mockResolvedValue(list([{...item, revision: 9}])); await click("刷新列表");
        mocks.get.mockResolvedValue(list([])); await click("删除");
        expect(mocks.remove).toHaveBeenLastCalledWith("/api/admin/announcements/one", {body: JSON.stringify({revision: 9})});
    });
    it("keeps failures retryable without optimistic changes or automatic retries", async () => {
        await render(); mocks.patch.mockRejectedValueOnce(new Error("synthetic offline")); await click("隐藏");
        expect(host.textContent).toContain(item.titleZh); expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(mocks.patch).toHaveBeenCalledTimes(1); expect(button("隐藏").disabled).toBe(false);
        await click("隐藏"); expect(mocks.patch).toHaveBeenCalledTimes(2);
    });
    it.each(["delete", "hide"])("returns to the valid page when %s removes the last row", async action => {
        const first = {...item, id: "first", titleZh: "第一页合成公告"};
        mocks.get.mockImplementation(async (url: string) => url.endsWith("page=2") ? list([item], 21, 2) : list([first], 21));
        await render(); if (action === "hide") await select("published"); await click("下一页");
        expect(host.textContent).toContain("第2页");
        mocks.get.mockImplementation(async (url: string) => url.endsWith("page=2") ? list([], 20, 2) : list([first], 20));
        vi.mocked(window.confirm).mockReturnValue(true); await click(action === "delete" ? "删除" : "隐藏");
        expect(host.textContent).toContain("第1页"); expect(host.textContent).toContain(first.titleZh);
    });
    it("does not allow quick actions while retaining an unsaved draft", async () => {
        await render(); await click("编辑");
        for (const name of ["置顶", "隐藏", "删除"]) expect(button(name).disabled).toBe(true);
        await click("删除"); expect(window.confirm).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
    });
    it("does not offer hide/republish for drafts or archives", async () => {
        mocks.get.mockResolvedValue(list([{...item, status: "draft"}, {...item, id: "archived", status: "archived"}])); await render();
        expect([...host.querySelectorAll("button")].some(b => ["隐藏", "恢复发布"].includes(b.textContent!))).toBe(false);
    });
    it("localizes quick actions and confirmation in English", async () => {
        mocks.lang = "en"; await render(); button("Pin"); button("Hide"); await click("Delete");
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(item.titleEn));
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("read receipts"));
    });
    it("denies non-admin UI without loading notices", async () => {
        mocks.role = "user"; await render(); expect(host.textContent).toContain("需要管理员权限"); expect(mocks.get).not.toHaveBeenCalled();
    });
});

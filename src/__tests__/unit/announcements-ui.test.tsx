import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import {NoticePanel} from "@/components/announcements/notice-panel";
import {useNotices} from "@/components/announcements/use-notices";
import {safeNoticeHref} from "@/lib/announcements/schema";
const {get, post, lang} = vi.hoisted(() => ({get: vi.fn(), post: vi.fn(), lang: {value: "zh"}}));
vi.mock("@/lib/api-client", () => ({apiClient: {get, post}}));
vi.mock("@/contexts/LanguageContext", () => ({useLanguage: () => ({language: lang.value})}));
const item = {id: "one", titleZh: "测试公告", bodyZh: "<script>alert(1)</script>", titleEn: "Test notice", bodyEn: "Text only", href: "/stats", readPolicy: "hide", status: "published", pinned: false, pinOrder: 0, startsAt: null, endsAt: null, revision: 1, createdAt: "", updatedAt: "", readAt: null};
const listing = {items: [item], total: 1, page: 1, pageSize: 20, unreadCount: 1};
function Panel() {return <NoticePanel feed={useNotices()}/>;}
let host: HTMLDivElement, root: Root;
beforeEach(() => {vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);get.mockReset();post.mockReset();lang.value = "zh";host = document.createElement("div");document.body.append(host);root = createRoot(host);});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
async function click(text: string) {const b = [...host.querySelectorAll("button")].find(b => b.textContent === text);expect(b).toBeDefined();await act(async () => b!.click());}
describe("notices without implicit acknowledgement", () => {
    it("does not acknowledge on opening, renders text safely, and hides only after explicit success", async () => {
        get.mockResolvedValue(listing);post.mockResolvedValue({readAt: "2026-09-26"});
        await act(async () => root.render(<Panel/>)); expect(post).not.toHaveBeenCalled();expect(host.querySelector("script")).toBeNull();expect(host.textContent).toContain("<script>");
        get.mockResolvedValue({...listing, items: [], total: 0, unreadCount: 0});await click("已阅，对我隐藏");
        expect(post).toHaveBeenCalledWith("/api/announcements/one/read", {});expect(host.textContent).not.toContain("测试公告");
    });
    it("keeps the card after failed acknowledgement and supports retry", async () => {
        get.mockResolvedValue(listing);post.mockRejectedValue(new Error("offline"));await act(async () => root.render(<Panel/>));await click("已阅，对我隐藏");
        expect(host.textContent).toContain("测试公告");expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(post).toHaveBeenCalledTimes(1);
        post.mockResolvedValue({});await click("已阅，对我隐藏");expect(post).toHaveBeenCalledTimes(2);
    });
    it("has serial refresh and ignores old-view responses", async () => {
        let finish!: (v: unknown) => void;get.mockImplementationOnce(() => new Promise(r => {finish = r;})).mockResolvedValue({...listing, items: []});
        await act(async () => root.render(<Panel/>));await act(async () => vi.advanceTimersByTimeAsync(60000));expect(get).toHaveBeenCalledTimes(1);
        await click("历史公告");await act(async () => finish(listing));expect(host.textContent).not.toContain("测试公告");
        await act(async () => vi.advanceTimersByTimeAsync(30000));expect(get).toHaveBeenCalledTimes(3);
    });
    it("localizes notice content and paginates", async () => {
        lang.value = "en";get.mockResolvedValue({...listing, total: 23});await act(async () => root.render(<Panel/>));expect(host.textContent).toContain("Test notice");await click("Next");
        expect(get).toHaveBeenLastCalledWith("/api/announcements?view=inbox&page=2", expect.anything());
    });
    it("rejects unsafe related links", () => {
        for (const path of ["//evil.invalid", "/%2fevil.invalid", "javascript:alert(1)", "/\\evil", "/%0aevil"]) expect(safeNoticeHref(path)).toBe(false);
        expect(safeNoticeHref("/solving-records?status=completed")).toBe(true);
    });
});

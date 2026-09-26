import {z} from "zod";
export const statuses = ["draft", "published", "hidden", "archived"] as const;
export const policies = ["keep", "hide", "persistent"] as const;
// Only same-site paths; reject encoded controls/slashes as well as protocol-relative URLs.
export function safeNoticeHref(value: string): boolean {
    if (!value) return true;
    if (!value.startsWith("/") || value.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(value)) return false;
    try {
        const decoded = decodeURIComponent(value);
        if (decoded.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(decoded)) return false;
        return new URL(value, "https://notice.invalid").origin === "https://notice.invalid";
    } catch { return false; }
}
export const announcementInput = z.object({
    titleZh: z.string().trim().min(1).max(120), bodyZh: z.string().trim().min(1).max(6000),
    titleEn: z.string().trim().max(120).default(""), bodyEn: z.string().trim().max(6000).default(""),
    href: z.string().trim().max(400).refine(safeNoticeHref).default(""),
    status: z.enum(statuses), pinned: z.boolean(), pinOrder: z.number().int().min(0).max(9999),
    readPolicy: z.enum(policies),
    startsAt: z.iso.datetime({offset: true}).nullable(), endsAt: z.iso.datetime({offset: true}).nullable(),
}).strict().refine(v => !v.startsAt || !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), {message: "Invalid time window"});
export type AnnouncementInput = z.infer<typeof announcementInput>;
export type Announcement = AnnouncementInput & {
    id: string; revision: number; createdAt: string; updatedAt: string; readAt?: string | null;
};
export type NoticeView = "inbox" | "history";
export type AnnouncementList = {items: Announcement[]; total: number; page: number; pageSize: number; unreadCount?: number};

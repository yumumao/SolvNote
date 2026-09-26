import {requireAdmin, assertSameOrigin, aiJson, readAIJson} from "@/lib/ai-access";
import {listAdminNotices, saveNotice} from "@/lib/announcements/store";
import {noticeError} from "@/lib/announcements/http";
export async function GET(req: Request) {
    try { await requireAdmin(req); return aiJson(await listAdminNotices(new URL(req.url).searchParams)); }
    catch (error) { return noticeError(error); }
}
export async function POST(req: Request) {
    try { assertSameOrigin(req); await requireAdmin(req); return aiJson(await saveNotice(await readAIJson(req, 65536)), 201); }
    catch (error) { return noticeError(error); }
}

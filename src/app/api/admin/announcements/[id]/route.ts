import {requireAdmin, assertSameOrigin, aiJson, readAIJson} from "@/lib/ai-access";
import {deleteNotice, saveNotice, updateNoticeAction} from "@/lib/announcements/store";
import {noticeError, noticeId} from "@/lib/announcements/http";
export async function PUT(req: Request, context: {params: Promise<{id: string}>}) {
    try {
        assertSameOrigin(req); await requireAdmin(req);
        const id = noticeId((await context.params).id);
        return aiJson(await saveNotice(await readAIJson(req, 65536), id));
    } catch (error) { return noticeError(error); }
}
export async function PATCH(req: Request, context: {params: Promise<{id: string}>}) {
    try {
        assertSameOrigin(req); await requireAdmin(req);
        const id = noticeId((await context.params).id);
        return aiJson(await updateNoticeAction(await readAIJson(req, 8192), id));
    } catch (error) { return noticeError(error); }
}
export async function DELETE(req: Request, context: {params: Promise<{id: string}>}) {
    try {
        assertSameOrigin(req); await requireAdmin(req);
        const id = noticeId((await context.params).id);
        return aiJson(await deleteNotice(await readAIJson(req, 8192), id));
    } catch (error) { return noticeError(error); }
}

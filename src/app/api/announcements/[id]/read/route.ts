import {requireUser, assertSameOrigin, aiJson} from "@/lib/ai-access";
import {acknowledgeNotice} from "@/lib/announcements/store";
import {noticeError, noticeId} from "@/lib/announcements/http";
export async function POST(req: Request, context: {params: Promise<{id: string}>}) {
    try {
        assertSameOrigin(req);
        const user = await requireUser(req);
        return aiJson(await acknowledgeNotice(user.id, noticeId((await context.params).id)));
    } catch (error) { return noticeError(error); }
}

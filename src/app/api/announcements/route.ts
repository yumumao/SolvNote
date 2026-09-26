import {requireUser, aiJson, AIRequestError} from "@/lib/ai-access";
import {listNotices, parsePage} from "@/lib/announcements/store";
import {noticeError} from "@/lib/announcements/http";
export async function GET(req: Request) {
    try {
        const user = await requireUser(req), params = new URL(req.url).searchParams;
        const view = params.get("view") ?? "inbox";
        if (view !== "inbox" && view !== "history") throw new AIRequestError(400, "Invalid view");
        return aiJson(await listNotices(user.id, view, parsePage(params)));
    } catch (error) { return noticeError(error); }
}

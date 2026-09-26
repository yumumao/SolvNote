import {AIRequestError, aiJson} from "@/lib/ai-access";
export function noticeError(error: unknown) {
    return aiJson({message: error instanceof AIRequestError ? error.message : "Announcements temporarily unavailable"},
        error instanceof AIRequestError ? error.status : 503);
}
export function noticeId(value: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new AIRequestError(400, "Invalid notice");
    return value;
}

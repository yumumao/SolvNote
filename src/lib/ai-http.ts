import { NextResponse } from "next/server";
export async function readJSON(req: Request, limit = 1024 * 1024) {
    if (Number(req.headers.get("content-length") || 0) > limit)
        throw Error("BODY_TOO_LARGE");
    const reader = req.body?.getReader();
    if (!reader) throw Error("INVALID_REQUEST");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
            await reader.cancel();
            throw Error("BODY_TOO_LARGE");
        }
        chunks.push(value);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw Error("INVALID_REQUEST");
    }
}
export function safeError(e: unknown) {
    const code = e instanceof Error ? e.message : "";
    const status =
        typeof e === "object" && e !== null && "status" in e
            ? Number((e as { status: unknown }).status)
            : 0;
    if (status === 503)
        return NextResponse.json(
            { message: "AUTHENTICATION_UNAVAILABLE" },
            { status: 503 },
        );
    if (status === 401 || status === 403)
        return NextResponse.json(
            { message: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" },
            { status },
        );
    if (code === "CONFIG_CONFLICT" || code === "REQUEST_CONFLICT")
        return NextResponse.json({ message: code }, { status: 409 });
    if (code === "AI_QUEUE_FULL")
        return NextResponse.json({ message: code }, { status: 429 });
    return NextResponse.json(
        {
            message:
                code === "BODY_TOO_LARGE"
                    ? "BODY_TOO_LARGE"
                    : "INVALID_REQUEST_OR_CONFIGURATION",
        },
        { status: code === "BODY_TOO_LARGE" ? 413 : 400 },
    );
}

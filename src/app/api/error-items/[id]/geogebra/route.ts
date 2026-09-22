import { enqueue } from "@/lib/ai-jobs/enqueue";
export const runtime = "nodejs";
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    return enqueue(req, "geogebra", id);
}

import { enqueue } from "@/lib/ai-jobs/enqueue";
export const runtime = "nodejs";
export async function POST(req: Request) {
    return enqueue(req, "geogebra");
}

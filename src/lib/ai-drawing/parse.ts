import { z } from "zod";
import { parseJSON } from "../ai-dialogue/protocol";
import { AIError } from "../ai/transport";
import { ConstructionSchema, compileConstruction } from "./construction";

const ResponseSchema = z.union([ConstructionSchema, z.object({unsupported: z.literal(true)}).strict()]);
export function parseConstruction(raw: string) {
    const result = parseJSON(raw, ResponseSchema);
    if ("unsupported" in result) throw new AIError("AI_DRAWING_UNSUPPORTED", false, 0, "DRAWING_UNSUPPORTED");
    try { compileConstruction(result); }
    catch { throw new AIError("AI_DRAWING_INVALID", true, 0, "DRAWING_INVALID"); }
    return result;
}

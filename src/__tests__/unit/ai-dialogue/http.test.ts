// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AIRequestError } from "@/lib/ai-access";
import { dialogueHTTPError } from "@/lib/ai-dialogue/http";

async function body(response: Response) {
    return await response.json();
}

describe("dialogue HTTP error mapping", () => {
    it("keeps invalid client requests at HTTP 400", async () => {
        const response = dialogueHTTPError(new AIRequestError(400, "INVALID_REQUEST"));
        expect(response.status).toBe(400);
        expect(await body(response)).toEqual({ message: "INVALID_REQUEST" });
    });

    it("returns stale image-editor configuration as a conflict", async () => {
        const response = dialogueHTTPError(
            new AIRequestError(409, "AI_IMAGE_EDIT_SETTINGS_CHANGED"),
        );
        expect(response.status).toBe(409);
        expect(await body(response)).toEqual({
            message: "AI_IMAGE_EDIT_SETTINGS_CHANGED",
        });
    });

    it("does not expose an unrecognized internal image-editor error", async () => {
        const response = dialogueHTTPError(new Error("provider secret"));
        expect(response.status).toBe(503);
        expect(await body(response)).toEqual({ message: "DIALOGUE_UNAVAILABLE" });
    });
});

 it("requires explicit recovery confirmation without hiding the client error",async()=>{
  const response=dialogueHTTPError(new AIRequestError(400,"DIALOGUE_RETRY_CONFIRM_REQUIRED"));
  expect(response.status).toBe(400);expect(await body(response)).toEqual({message:"DIALOGUE_RETRY_CONFIRM_REQUIRED"});
 });

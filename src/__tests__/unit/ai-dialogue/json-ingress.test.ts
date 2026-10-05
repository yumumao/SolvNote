// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DecisionSchema, parseGeometryCheck, parseJSON, parseTranscript } from "@/lib/ai-dialogue/protocol";

// All replies are synthetic. The parser must preserve content, not fabricate it.
const transcript = { text: "Synthetic $x$", facts: [], uncertainties: [], missingInformation: [] };
const rawText = (text: string) => `{"text":"${text}","facts":[],"uncertainties":[],"missingInformation":[]}`;
const invalid = (raw: string) => expect(() => parseTranscript(raw)).toThrow(expect.objectContaining({ diagnostic: "JSON_INVALID" }));

describe("complete AI JSON with harmless surrounding prose", () => {
    it.each([
        (s: string) => `以下是转录结果：\n${s}`,
        (s: string) => `${s}\n以上为完整转录。`,
        (s: string) => `以下是转录：\n\`\`\`json\n${s}\n\`\`\`\n请核对不确定项。`,
        (s: string) => `<think>discarded synthetic draft {}</think>\n转录如下：\n${s}`,
    ])("accepts one complete top-level value with wrapper %s", wrap => {
        expect(parseTranscript(wrap(JSON.stringify(transcript)))).toEqual(transcript);
    });
    it("ignores braces, quotes and fence-like text inside JSON string values", () => {
        const value = { ...transcript, text: 'Synthetic {x} [y] "quoted" ``` <think>literal</think>' };
        expect(parseTranscript(`结果：\n${JSON.stringify(value)}\n完毕。`)).toEqual(value);
    });
    it.each([
        `<think>${JSON.stringify(transcript)}`,
        `说明\n<think>${JSON.stringify(transcript)}`,
        `结果：\n${JSON.stringify(transcript)}\n${JSON.stringify(transcript)}`,
        `\`\`\`json\n${JSON.stringify(transcript)}\n\`\`\`\n\`\`\`json\n${JSON.stringify(transcript)}\n\`\`\``,
        `{"wrapper":${JSON.stringify(transcript)}`,
        `${JSON.stringify(transcript)}\n{"text":"incomplete`,
        `结果：\n${JSON.stringify(transcript).slice(0, -1)}`,
        rawText('unescaped "quote"'),
        rawText(String.raw`unknown \unknownCommand`),
        rawText(String.raw`outside math \angle ABC`),
        rawText(String.raw`unclosed math $\angle ABC`),
        '{"text":"synthetic",}',
    ])("rejects ambiguous, broken or truncated content %#", invalid);
});

describe("bounded LaTeX escaping at the AI ingress", () => {
    it.each([
        String.raw`$\frac{1}{2}$`, String.raw`$\theta+\beta+\nu+\rho$`,
        String.raw`$\tan x \times 2 \neq 1$`, String.raw`$\bar{x}+\text{cm}$`,
        String.raw`$\sqrt{4}+\angle ABC+\alpha$`,
        String.raw`$$\begin{aligned}x&=\frac{1}{2}\\y&=2\end{aligned}$$`,
        String.raw`$\left\{x\mid x\ge 0\right\}$`,
    ])("preserves a recognized math command instead of rejecting/corrupting it: %s", text => {
        // A raw TeX line break is already a valid JSON slash pair; encode it once.
        const raw = rawText(text.replaceAll(String.raw`\\`, String.raw`\\\\`));
        expect(parseTranscript(raw).text).toBe(text);
    });
    it("handles mixed escaped and unescaped commands without double decoding", () => {
        expect(parseTranscript(rawText(String.raw`$\frac{1}{2}+\\sqrt{4}$`)).text).toBe(String.raw`$\frac{1}{2}+\sqrt{4}$`);
    });
    it("repairs unescaped line breaks only inside a complete string", () => {
        expect(parseTranscript(rawText('first\nsecond\tcolumn\r\nend')).text).toBe('first\nsecond\tcolumn\r\nend');
    });
    it("keeps all correctly JSON-encoded text byte-for-byte after decoding", () => {
        const text = String.raw`$\frac{1}{2}+\theta$; literal \\; escaped dollar \$; "quoted"; C:\temp\new` + '\nnext\ttab\r\nline';
        expect(parseTranscript(JSON.stringify({ ...transcript, text })).text).toBe(text);
    });
    it("keeps JSON newline, tab, Unicode and slash escapes, even inside math", () => {
        expect(parseTranscript(rawText(String.raw`$x\n+y\t+\u03b1$ \/`)).text).toBe('$x\n+y\t+α$ /');
    });
    it("normalizes formula escapes in facts as well as transcript text", () => {
        const result = parseTranscript(String.raw`{"text":"synthetic","facts":[{"detail":"$\angle ABC=\theta$","source":"image"}],"uncertainties":[],"missingInformation":[]}`);
        expect(result.facts).toEqual([{ detail: String.raw`$\angle ABC=\theta$`, source: "image" }]);
    });
    it("uses the same ingress for solve results and geometry-check doubts", () => {
        const decision = parseJSON(String.raw`答案如下： {"status":"solved","result":{"questionText":"synthetic","answerText":"$\frac{1}{2}$","analysis":"$\theta$"}}`, DecisionSchema);
        expect(decision).toMatchObject({ status: "solved", result: { answerText: String.raw`$\frac{1}{2}$`, analysis: String.raw`$\theta$` } });
        expect(parseGeometryCheck(String.raw`核对结果：{"angles":[],"geometryUncertainties":["$\angle ABC$不清楚"]}`).geometryUncertainties).toEqual([String.raw`$\angle ABC$不清楚`]);
    });
    it("still validates schema and geometric evidence after wrapper/escape normalization", () => {
        expect(() => parseTranscript('结果：{"facts":[]}')).toThrow(expect.objectContaining({ diagnostic: "JSON_SCHEMA_INVALID" }));
        const bad = { ...transcript, geometry: { angles: [{ label: "1", vertex: "B", arms: ["B", "C"] }] } };
        expect(() => parseTranscript(`结果：${JSON.stringify(bad)}`)).toThrow(expect.objectContaining({ diagnostic: "GEOMETRY_INVALID" }));
    });
    it("rejects oversized replies before recovery and never leaks response details", () => {
        expect(() => parseTranscript("x".repeat(180001))).toThrow(expect.objectContaining({ diagnostic: "JSON_TOO_LARGE" }));
        try { parseTranscript('PRIVATE-SYNTHETIC {"text":"unfinished'); }
        catch (error) { expect(String(error)).toBe("Error: AI_RESPONSE_ERROR"); expect(JSON.stringify(error)).not.toContain("PRIVATE-SYNTHETIC"); return; }
        throw Error("Expected rejection");
    });
});

describe("all supported response protocols share the same content boundary", () => {
    it.each(["chat", "responses", "responses_codex", "gemini"] as const)("normalizes %s without changing transport completion checks", async protocol => {
        const { decodeResponse } = await import("@/lib/ai/transport");
        const text = String.raw`转录：{"text":"synthetic $\frac{1}{2}+\angle ABC$","facts":[],"uncertainties":[],"missingInformation":[]}`;
        const envelope = protocol === "chat" ? { choices: [{ finish_reason: "stop", message: { content: text } }] }
            : protocol === "gemini" ? { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }
                : { status: "completed", output_text: text };
        expect(parseTranscript(await decodeResponse(Response.json(envelope), protocol)).text).toBe(String.raw`synthetic $\frac{1}{2}+\angle ABC$`);
        const truncated = protocol === "chat" ? { choices: [{ finish_reason: "length", message: { content: text } }] }
            : protocol === "gemini" ? { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text }] } }] }
                : { status: "incomplete", output_text: text };
        await expect(decodeResponse(Response.json(truncated), protocol)).rejects.toMatchObject({ diagnostic: "OUTPUT_TRUNCATED" });
    });
});

describe("ambiguous wrappers and math delimiters stay bounded", () => {
    it("does not consume a JSON answer still inside a nested unclosed thinking block", () => {
        invalid(`<think>outer <think>inner</think>${JSON.stringify(transcript)}`);
    });
    it.each(["true", "null", "42"])("does not discard a separate top-level scalar %s", scalar => {
        invalid(`${scalar}\n${JSON.stringify(transcript)}`);
        invalid(`${JSON.stringify(transcript)}\n${scalar}`);
    });
    it("does not mistake a literal escaped dollar in math for the end of the formula", () => {
        expect(parseTranscript(rawText(String.raw`$\text{cost \\$5}+\theta$`)).text).toBe(String.raw`$\text{cost \$5}+\theta$`);
    });
});

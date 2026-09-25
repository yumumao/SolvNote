/** Normalize delimiter boundaries, not mathematical content. Code/math are opaque
 * to the legacy prose paragraph cleanup. No HTML or executable TeX is enabled. */
export function normalizeMathMarkdown(content: string): string {
    const out: string[] = [];
    let prose = "";
    const flush = () => {
        out.push(prose
            .replace(/\\n(?![a-zA-Z])/g, "\n")
            .replace(/([。！？；.!?;])[\t ]*\n(?!\n)/g, "$1\n\n")
            .replace(/(\d+\)|[\u2460-\u2473])[\t ]*\n(?!\n)/g, "$1\n\n"));
        prose = "";
    };
    const escapeFlags = new Uint8Array(content.length);
    for (let i = 1; i < content.length; i++) escapeFlags[i] = content[i - 1] === "\\" ? 1 - escapeFlags[i - 1] : 0;
    const escaped = (at: number) => escapeFlags[at] === 1;
    const closing = (token: string, start: number) => {
        let at = content.indexOf(token, start);
        while (at >= 0 && (escaped(at) || (token === "$" && (content[at - 1] === "$" || content[at + 1] === "$")))) {
            at = content.indexOf(token, at + token.length);
        }
        return at;
    };
    for (let i = 0; i < content.length;) {
        // Protect complete code fences, including unclosed fences through EOF.
        if (i === 0 || content[i - 1] === "\n") {
            const line = content.slice(i, content.indexOf("\n", i) < 0 ? undefined : content.indexOf("\n", i));
            const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
            if (fence) {
                const end = new RegExp("^ {0,3}" + fence[1][0] + "{" + fence[1].length + ",}[\\t ]*\\r?$", "gm");
                end.lastIndex = i + line.length + 1;
                const match = end.exec(content);
                const until = match ? match.index + match[0].length : content.length;
                flush(); out.push(content.slice(i, until)); i = until; continue;
            }
            if (/^(?: {4}|\t)/.test(line)) {
                flush(); out.push(line); i += line.length; continue;
            }
        }
        // Inline code uses an exactly matching backtick run.
        if (content[i] === "`" && !escaped(i)) {
            const run = /^`+/.exec(content.slice(i))![0];
            const matcher = /`+/g; matcher.lastIndex = i + run.length;
            let match: RegExpExecArray | null;
            while ((match = matcher.exec(content)) && match[0].length !== run.length) { /* find matching run */ }
            if (match) {
                const until = match.index + run.length;
                flush(); out.push(content.slice(i, until)); i = until; continue;
            }
        }
        let open = "", close = "", display = false;
        if (!escaped(i)) {
            if (content.startsWith("$$", i)) { open = close = "$$"; display = true; }
            else if (content.startsWith("\\[", i)) { open = "\\["; close = "\\]"; display = true; }
            else if (content.startsWith("\\(", i)) { open = "\\("; close = "\\)"; }
            else if (content[i] === "$" && content[i - 1] !== "$") { open = close = "$"; }
        }
        if (open) {
            const end = closing(close, i + open.length);
            if (end >= 0) {
                const body = content.slice(i + open.length, end);
                // Never join unrelated prose paragraphs as inline math.
                if ((display || !/\n[\t ]*\n/.test(body)) && !/^ {0,3}(?:`{3,}|~{3,})/m.test(body)) {
                    flush();
                    out.push(display ? "\n\n$$\n" + body.trim() + "\n$$\n\n" : "$" + body + "$");
                    i = end + close.length; continue;
                }
            }
        }
        prose += content[i++];
    }
    flush();
    return out.join("");
}

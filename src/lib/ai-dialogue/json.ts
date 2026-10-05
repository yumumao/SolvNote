/** Bounded model-output compatibility, not a general-purpose JSON repairer.
 * Never close missing structures, choose between candidates, or alter evidence.
 * Keep this module independent of providers, persistence and paid retries.
 */
const latexCommands = new Set((
    "frac dfrac tfrac cfrac sqrt angle measuredangle triangle square circ degree " +
    "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega " +
    "Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega " +
    "begin end left right middle text textrm textbf textit operatorname mathrm mathbf mathit mathbb mathcal mathsf mathscr " +
    "bar overline underline vec hat widehat tilde widetilde dot ddot overrightarrow overleftrightarrow underbrace overbrace " +
    "sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln exp lim min max det gcd " +
    "sum prod int iint iiint oint partial nabla infty pm mp times div cdot cdots ldots vdots ddots " +
    "le leq ge geq ne neq approx equiv sim simeq cong propto parallel perp mid nmid nparallel " +
    "in notin ni subset supset subseteq supseteq cup cap emptyset varnothing forall exists neg land lor " +
    "to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow iff implies " +
    "quad qquad hspace vspace displaystyle textstyle big Big bigg Bigg bigl bigr Bigl Bigr lvert rvert vert Vert lbrace rbrace langle rangle"
).split(/\s+/));
const invalid = (): never => { throw new SyntaxError("INVALID_AI_JSON"); };

/** The prompt requires dollar-delimited math. Only complete math spans opt in
 * to TeX repair; ordinary JSON escapes, paths, quotes and unknown text stay strict.
 */
function normalizeMathSpan(span: string): string {
    let result = "";
    for (let i = 0; i < span.length; i++) {
        const char = span[i];
        if (char !== "\\") { result += char; continue; }
        const next = span[i + 1];
        // Already serialized JSON escapes must not be decoded twice.
        if (next === "\\" || next === '"' || next === "/" ||
            (next === "u" && /^[0-9a-fA-F]{4}/.test(span.slice(i + 2, i + 6)))) {
            result += char + next; i++; continue;
        }
        const command = /^[A-Za-z]+/.exec(span.slice(i + 1))?.[0];
        if ((command && latexCommands.has(command)) || (next && "{}[],;!%_#:$".includes(next))) {
            result += "\\\\";
        } else { result += char; }
    }
    return result;
}

function mathEscapes(content: string): string {
    const delimiterAt = (index: number): string => {
        if (content[index] !== "$" || content[index - 1] === "$") return "";
        let slashes = 0;
        for (let i = index - 1; i >= 0 && content[i] === "\\"; i--) slashes++;
        // Two serialized slashes decode to one TeX escape; four to a line break.
        if (slashes % 4 !== 0) return "";
        const count = content[index + 1] === "$" ? (content[index + 2] === "$" ? 3 : 2) : 1;
        return count <= 2 ? "$".repeat(count) : "";
    };
    let result = "", from = 0;
    for (let i = 0; i < content.length; i++) {
        const delimiter = delimiterAt(i);
        if (!delimiter) continue;
        let end = i + delimiter.length;
        while (end < content.length && delimiterAt(end) !== delimiter) end++;
        if (end === content.length) break; // An unmatched delimiter is not a repair license.
        end += delimiter.length;
        result += content.slice(from, i) + normalizeMathSpan(content.slice(i, end));
        from = end;
        i = end - 1;
    }
    return result + content.slice(from);
}

function normalizeStrings(text: string): string {
    // Escaped quotes are part of a string, never candidate boundaries. Keys do
    // not carry Markdown; leave them alone so schema validation stays strict.
    return text.replace(/"(?:\\[\s\S]|[^"\\])*"/g, (token: string, offset: number) => {
        if (/^\s*:/.test(text.slice(offset + token.length))) return token;
        return '"' + mathEscapes(token.slice(1, -1))
            .replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
    });
}

function completeCandidate(text: string): string {
    const start = text.search(/[\[{]/);
    if (start < 0) return invalid();
    let prefix = text.slice(0, start).trim();
    const fenced = /```(?:json)?\s*$/i.test(prefix);
    if (fenced) prefix = prefix.replace(/```(?:json)?\s*$/i, "").trim();
    // No nested/example candidates, partial reasoning, or other code fences.
    const ambiguousWrapper = (value: string) => /[{}\[\]`"\\]|<\/?think\b/i.test(value) ||
        /^(?:true|false|null)(?=\s|$)|^-?\d/i.test(value);
    if (ambiguousWrapper(prefix)) return invalid();
    const stack: string[] = [];
    let quoted = false;
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === "\\") i++;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') { quoted = true; continue; }
        if (char === "{" || char === "[") stack.push(char);
        else if (char === "}" || char === "]") {
            if (stack.pop() !== (char === "}" ? "{" : "[")) return invalid();
            if (!stack.length) {
                let suffix = text.slice(i + 1).trim();
                if (fenced) {
                    if (!suffix.startsWith("```")) return invalid();
                    suffix = suffix.slice(3).trim();
                }
                if (ambiguousWrapper(suffix)) return invalid();
                return text.slice(start, i + 1);
            }
        }
    }
    return invalid(); // No closing object/string: never fabricate missing output.
}

export function parseModelJSON(raw: string): unknown {
    // Reasoning is never an answer. Strip only closed leading blocks.
    let text = raw.trim();
    while (/^<think>/i.test(text)) {
        const end = text.toLowerCase().indexOf("</think>");
        if (end < 0 || /<think\b/i.test(text.slice(7, end))) return invalid();
        text = text.slice(end + 8).trimStart();
    }
    if (/^<think\b/i.test(text)) return invalid();
    try { return JSON.parse(normalizeStrings(text)); }
    catch { return JSON.parse(normalizeStrings(completeCandidate(text))); }
}

// Construct the example with the JSON serializer, not a hand-escaped template.
// This catches the same \f / \t / \b / \n / \r trap in prompts as in responses.
export const JSON_OUTPUT_RULES = String.raw`【JSON序列化检查】只输出一个完整JSON对象，不附加开场白、结语或代码围栏。先完成正文，再按JSON规则序列化一次；公式反斜杠、双引号、换行都必须正确转义。尤其不要把\frac、\theta、\beta、\nu、\rho中的开头误写成JSON控制转义。格式示例（不是题设）：
${JSON.stringify({ text: String.raw`$\frac{1}{2}+\theta+\beta+\nu+\rho$` })}
不要截断字段、补造题设或用第二份JSON更正第一份；输出前检查数组、引号和大括号均完整闭合。`;

/** Keep operational counts/flags; free-form content never belongs in diagnostic logs. */
export function privateLogContext(value: unknown, depth = 0): unknown {
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : '[REDACTED]';
    if (typeof value === 'string') return '[REDACTED]';
    if (depth >= 6) return '[REDACTED]';
    if (value instanceof Error) {
        const name = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(value.name) ? value.name : 'Error';
        return { name };
    }
    if (Array.isArray(value)) return value.slice(0, 20).map(item => privateLogContext(item, depth + 1));
    if (typeof value === 'object') {
        const result: Record<string, unknown> = Object.create(null);
        for (const [key, item] of Object.entries(value).slice(0, 40)) {
            if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) continue;
            result[key] = privateLogContext(item, depth + 1);
        }
        return result;
    }
    return '[REDACTED]';
}

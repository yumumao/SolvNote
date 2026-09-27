import {
    randomBytes,
    pbkdf2,
    createCipheriv,
    createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import { ConfigSchema, parseConfig } from "./schema";
import { ImportConfigError, safeIssuePath } from "./import-errors";
const derive = promisify(pbkdf2);
export const MAX_EXPORT_BYTES = 1024 * 1024;
export interface ExportEnvelope {
    format: "portable-ai-config";
    v: 1;
    alg: "AES-256-GCM";
    kdf: "PBKDF2-SHA256";
    iter: 300000;
    salt: string;
    iv: string;
    data: string;
}
function bytes(v: unknown, length?: number) {
    if (
        typeof v !== "string" ||
        v.length > MAX_EXPORT_BYTES ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(v)
    )
        throw Error("INVALID_EXPORT");
    const b = Buffer.from(v, "base64");
    if (
        b.toString("base64") !== v ||
        (length !== undefined && b.length !== length)
    )
        throw Error("INVALID_EXPORT");
    return b;
}
export function encryptWithKey(text: string, key: Buffer) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    return {
        iv: iv.toString("base64"),
        data: Buffer.concat([
            c.update(text, "utf8"),
            c.final(),
            c.getAuthTag(),
        ]).toString("base64"),
    };
}
export function decryptWithKey(e: { iv: string; data: string }, key: Buffer) {
    const data = Buffer.from(e.data, "base64");
    const c = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"));
    c.setAuthTag(data.subarray(-16));
    return Buffer.concat([c.update(data.subarray(0, -16)), c.final()]).toString(
        "utf8",
    );
}
export async function sealExport(
    config: unknown,
    password: string,
): Promise<ExportEnvelope> {
    if (password.length < 12 || password.length > 1024 || !password.trim())
        throw Error("PASSPHRASE_LENGTH");
    const c = parseConfig(config);
    const salt = randomBytes(16);
    const key = await derive(password, salt, 300000, 32, "sha256");
    const enc = encryptWithKey(JSON.stringify(c), key);
    const envelope: ExportEnvelope = {
        format: "portable-ai-config",
        v: 1,
        alg: "AES-256-GCM",
        kdf: "PBKDF2-SHA256",
        iter: 300000,
        salt: salt.toString("base64"),
        ...enc,
    };
    if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > MAX_EXPORT_BYTES) throw Error("EXPORT_TOO_LARGE");
    return envelope;
}
export async function openExport(raw: unknown, password: string) {
    if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_EXPORT_BYTES ||
        typeof password !== "string" ||
        password.length > 1024
    )
        throw Error("INVALID_EXPORT");
    // Locally filled, plaintext portable-v1 templates use the SAME validation and
    // preview/CAS path as decrypted exports. Never downgrade an encrypted envelope.
    if ("version" in raw && raw.version === 1 &&
        !["format", "v", "alg", "kdf", "iter", "salt", "iv", "data"].some(key => key in raw)) {
        return parseImportedConfig(raw);
    }
    if (password.length < 12) throw Error("INVALID_EXPORT");
    const e = raw as ExportEnvelope;
    if (
        e.format !== "portable-ai-config" ||
        e.v !== 1 ||
        e.alg !== "AES-256-GCM" ||
        e.kdf !== "PBKDF2-SHA256" ||
        e.iter !== 300000
    )
        throw Error("UNSUPPORTED_EXPORT");
    const salt = bytes(e.salt, 16);
    bytes(e.iv, 12);
    if (bytes(e.data).length < 16) throw Error("INVALID_EXPORT");
    let text: string;
    try {
        text = decryptWithKey(e, await derive(password, salt, e.iter, 32, "sha256"));
    } catch {
        // Only GCM authentication/decryption failures belong to this category.
        throw Error("INVALID_EXPORT_OR_PASSPHRASE");
    }
    let payload: unknown;
    try { payload = JSON.parse(text); }
    catch { throw Error("INVALID_EXPORT_PAYLOAD"); }
    return parseImportedConfig(payload);
}

function parseImportedConfig(payload: unknown) {
    const result = ConfigSchema.safeParse(payload);
    if (!result.success) {
        throw new ImportConfigError(result.error.issues.map((issue) => ({
            path: safeIssuePath(issue.path),
            reason: issue.path.at(-1) === "baseUrl" ? "URL_POLICY"
                : issue.path.length === 0 && issue.code === "custom" ? "REFERENCES_OR_CHAINS" : "FIELD_CONSTRAINT",
        })));
    }
    return result.data;
}

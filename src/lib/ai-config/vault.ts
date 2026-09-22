import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { decryptWithKey, encryptWithKey } from "./crypto";
export function masterKey(create = false): Buffer {
    const configured = process.env.AI_CONFIG_MASTER_KEY;
    if (configured) {
        const k = Buffer.from(
            configured,
            /^[a-f0-9]{64}$/i.test(configured) ? "hex" : "base64",
        );
        if (k.length !== 32) throw Error("AI_MASTER_KEY_INVALID");
        return k;
    }
    const dir = process.env.AI_CONFIG_DIR || path.join(process.cwd(), "config");
    const file = path.join(dir, "ai-master.key");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(file)) {
        if (!create) throw Error("AI_MASTER_KEY_MISSING");
        try {
            fs.writeFileSync(file, randomBytes(32), {
                flag: "wx",
                mode: 0o600,
            });
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
    }
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw Error("AI_MASTER_KEY_INVALID");
    return key;
}
export function protect(value: unknown) {
    return JSON.stringify(encryptWithKey(JSON.stringify(value), masterKey()));
}
export function unprotect<T>(value: string): T {
    return JSON.parse(decryptWithKey(JSON.parse(value), masterKey())) as T;
}

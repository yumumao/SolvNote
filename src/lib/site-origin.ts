/** Explicit deployment URL wins over the internal Next URL. Never trust proxy headers here. */
export function canonicalSiteOrigin(requestUrl: string): string {
    try {
        const url = new URL(process.env.NEXTAUTH_URL || requestUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
            throw new Error("INVALID_SITE_ORIGIN");
        }
        return url.origin;
    } catch {
        // Do not expose the configured value, including accidental credentials.
        throw new Error("INVALID_SITE_ORIGIN");
    }
}

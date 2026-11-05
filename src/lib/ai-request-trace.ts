import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";

export type AIRequestPhase = "dns" | "requestCreated" | "requestHeaders" | "requestSent";
const requestScope = new AsyncLocalStorage<object>();

/** Observe this fetch only. Never read/copy headers, URLs, sockets or body data.
 * A send event is local transport progress, not proof of provider acceptance.
 */
export async function traceAIRequest<T>(run: () => Promise<T>, observe?: (phase: AIRequestPhase) => void): Promise<T> {
    if (!observe) return run();
    const scope = {};
    const requests = new WeakSet<object>();
    const emit = (phase: AIRequestPhase) => { try { observe(phase); } catch { /* Diagnostics must not alter a request. */ } };
    const subscriptions = [
        ["undici:request:create", (message: unknown) => {
            const request = (message as { request?: { method?: string } })?.request;
            // A proxy's CONNECT exchange is not the provider request.
            if (requestScope.getStore() === scope && request && request.method !== "CONNECT") {
                requests.add(request);
                emit("requestCreated");
            }
        }],
        ...([ ["undici:client:sendHeaders", "requestHeaders"], ["undici:request:bodySent", "requestSent"] ] as const)
            .map(([name, phase]) => [name, (message: unknown) => {
                const request = (message as { request?: object })?.request;
                if (request && requests.has(request)) emit(phase);
            }] as const),
    ] as const;
    for (const [name, listener] of subscriptions) channel(name).subscribe(listener);
    try { return await requestScope.run(scope, run); }
    finally { for (const [name, listener] of subscriptions) channel(name).unsubscribe(listener); }
}

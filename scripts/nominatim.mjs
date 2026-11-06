/**
 * Nominatim requires at most one public request per second. This queue is kept
 * on globalThis so every server route and bundled module shares the same rate
 * limit instead of each creating an independent queue.
 */
const globalNominatim = globalThis;
globalNominatim.__civisNominatimQueue ??= Promise.resolve();
globalNominatim.__civisNominatimNextAt ??= 0;
export function nominatimFetch(task) {
    const previous = globalNominatim.__civisNominatimQueue ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
        const wait = Math.max(0, (globalNominatim.__civisNominatimNextAt ?? 0) - Date.now());
        if (wait)
            await new Promise((resolve) => setTimeout(resolve, wait));
        try {
            return await task();
        }
        finally {
            // Wait after the response, so a slow request cannot overlap the next one.
            globalNominatim.__civisNominatimNextAt = Date.now() + 1_100;
        }
    });
    globalNominatim.__civisNominatimQueue = operation;
    return operation;
}

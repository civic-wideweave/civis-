/**
 * MapLibre is loaded lazily on the client only.
 *
 * Bundlers rewrite the module URL that MapLibre uses to spawn its worker, which
 * breaks tile parsing ("Worker failed to load"). We ship MapLibre's own worker
 * file from `public/maplibre/` and point the library at it once per page load.
 */
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
let cached = null;
function configureWorker(mod) {
    // setWorkerUrl is a named export of the ESM build. With some interop shapes it
    // only exists on the default object, so check both before giving up.
    const setter = mod.setWorkerUrl ?? mod.default?.setWorkerUrl;
    if (typeof setter !== "function") {
        console.error("[civis:map] MapLibre did not expose setWorkerUrl; tiles cannot be parsed.");
        return;
    }
    setter(WORKER_URL);
    if (process.env.NODE_ENV !== "production") {
        console.info("[civis:map] worker configured", WORKER_URL);
    }
}
export function loadMaplibre() {
    if (!cached) {
        cached = import("maplibre-gl").then((mod) => {
            const typed = mod;
            configureWorker(typed);
            return (typed.default && typed.default.Map ? typed.default : typed);
        });
    }
    return cached;
}

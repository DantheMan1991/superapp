import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy MapLibre's worker and its sibling chunk into `public/maplibre/`.
 *
 * **THE BUNDLER EMITS THE WORKER AND LOSES ITS IMPORT.** MapLibre v6 ships a
 * module worker that does `import ... from "./maplibre-gl-shared.mjs"`. Next
 * copies `maplibre-gl-worker.mjs` into `/_next/static/media/` under a
 * content-hashed name but does NOT emit the sibling and does NOT rewrite the
 * specifier — so the worker's own import 404s, returns the app's HTML shell,
 * and the browser refuses it with "non-JavaScript MIME type of text/html".
 *
 * The worker then never starts. Raster tiles keep working because they are
 * decoded on the main thread, so the map looks alive — but **every GeoJSON
 * source silently never parses**, no vector layer ever renders, and
 * `isStyleLoaded()` stays false forever. That is exactly how the boundary map
 * shipped: aerial imagery, a working zoom control, and no boundary on it.
 *
 * Serving both files ourselves and pointing `setWorkerUrl` at them keeps the
 * relative import intact, because they sit next to each other under a path we
 * control rather than one the bundler rewrites.
 *
 * Wired to `prebuild` and `predev` rather than committed, so the copies cannot
 * drift from the installed version — a stale worker against a bumped
 * `maplibre-gl` would be the same bug wearing a different hat.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const from = join(root, "node_modules", "maplibre-gl", "dist");
const to = join(root, "public", "maplibre");

// Both, always: the worker is useless without the chunk it imports, and the
// chunk alone is what the 404 was.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(to, { recursive: true });
for (const file of FILES) {
  copyFileSync(join(from, file), join(to, file));
}
console.log(`Copied ${FILES.length} MapLibre worker files into public/maplibre.`);

/**
 * WebGL capability probe.
 *
 * MapLibre GL JS v5 and later require WebGL 2. Probing for `webgl` — the
 * version-1 context — reports success on machines where `new Map()` then throws
 * a `GPUInitializationError`, which is exactly the case this probe exists to
 * catch, so the probe asks for `webgl2` specifically.
 *
 * The result is cached: creating and discarding a context is not free, and the
 * answer cannot change within a page's lifetime.
 */

let cached: boolean | null = null;

/**
 * True when this browser can render the map.
 *
 * Never call during server rendering — there is no `document`. The map
 * component runs this inside its mount effect, before constructing the map, so
 * an unsupported browser gets the station list rather than a caught exception.
 *
 * Everything is wrapped: some privacy-hardened browsers throw from
 * `getContext` rather than returning `null`, and a thrown probe must read as
 * "unsupported", not as a crash.
 */
export function isWebGL2Available(): boolean {
  if (cached !== null) return cached;
  if (typeof document === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    // `loseContext` releases the probe's GPU resources immediately instead of
    // waiting for the canvas to be collected. Browsers cap the number of live
    // contexts, and the map is about to ask for one.
    const lose = context?.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    cached = context !== null;
  } catch {
    cached = false;
  }

  return cached;
}

/** Test seam. Resets the memoised probe result. */
export function resetWebGLProbe(): void {
  cached = null;
}

/**
 * A WORKER THE PAGE'S LOCK HOLDS (ADR 0122, src/lib/posture-lock.ts).
 *
 * A worker started from an address on this site takes its content security
 * policy from that address's response, which has none: on a locked posture
 * page it could still reach any server (the drive proved it). A worker started
 * from a blob takes the page's policy instead.
 *
 * Next compiles a worker started from `new URL("…", import.meta.url)` into one
 * started from its bootstrap's address, with `#params=…` naming the chunks.
 * `startedFromBlob` runs that one start with `Worker` swapped for a stand-in
 * that starts the same bootstrap inside a blob: a single line that imports it,
 * kept with the `#params=` the bootstrap reads its chunks from. The chunks
 * still load from this site, which the lock allows. Nothing but that line is
 * ever in the blob.
 */
export function startedFromBlob(start: () => Worker): Worker {
  const Real = window.Worker;
  const fromBlob = function (url: string | URL, options?: WorkerOptions): Worker {
    const at = new URL(String(url), window.location.href);
    const script = JSON.stringify(`${at.origin}${at.pathname}${at.search}`);
    const boot = options?.type === "module" ? `import ${script};` : `importScripts(${script});`;
    const blob = URL.createObjectURL(new Blob([boot], { type: "text/javascript" }));
    return new Real(`${blob}${at.hash}`, options);
  } as unknown as typeof Worker;
  window.Worker = fromBlob;
  try {
    return start();
  } finally {
    window.Worker = Real;
  }
}

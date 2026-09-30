import { CHECKS, done, finished, openPostureDb, PHOTOS, type StoredCheck, type StoredPhoto } from "./db";

/**
 * THE CHECKS AND PHOTOS ON THIS PHONE, from the page (ADR 0118;
 * docs/modules/posture.md, slice 2). Read back for the report and the list,
 * deleted when the person says so. Nothing here sends anything anywhere.
 *
 * Every read is filtered to the signed-in personal space (`owner`): the
 * storage belongs to the browser, and a second person signed in on it must not
 * see the first one's checks.
 */

/**
 * A check left unfinished longer than this was abandoned, where the browser
 * cannot say so sooner (no Web Locks).
 */
const ABANDONED_MS = 2 * 60 * 60 * 1000;

const LOCK_PREFIX = "yosher-posture-check:";

/**
 * Held for as long as a check runs, and let go by the browser itself when the
 * page goes (a reload, the tab closed, the phone killing it), which React's
 * clean-up never sees. So a check whose lock nobody holds is abandoned, and
 * the next sweep deletes it and its photos at once, not hours later. Returns
 * the release.
 */
export function holdCheckLock(id: string): () => void {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return () => undefined;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void locks.request(`${LOCK_PREFIX}${id}`, () => held).catch(() => undefined);
  return () => release();
}

/** The checks some page is running now (their lock held or asked for); null when the browser cannot say. */
async function runningNow(): Promise<Set<string> | null> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.query) return null;
  try {
    const state = await locks.query();
    const names = [...(state.held ?? []), ...(state.pending ?? [])].map((l) => l.name ?? "");
    return new Set(names.filter((n) => n.startsWith(LOCK_PREFIX)).map((n) => n.slice(LOCK_PREFIX.length)));
  } catch {
    return null;
  }
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openPostureDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export function newCheckId(): string {
  return crypto.randomUUID();
}

export function saveCheck(check: StoredCheck): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(CHECKS, "readwrite");
    tx.objectStore(CHECKS).put(check);
    await finished(tx);
  });
}

/** This person's finished checks on this phone, newest first. */
export function listChecks(owner: string): Promise<StoredCheck[]> {
  return withDb(async (db) => {
    const all = (await done(db.transaction(CHECKS, "readonly").objectStore(CHECKS).index("owner").getAll(owner))) as StoredCheck[];
    return all.filter((c) => c.status === "done").sort((a, b) => b.at.localeCompare(a.at));
  });
}

/** Change a kept check in place: whether the account has it, and its last refusal. */
export function markCheck(id: string, patch: Pick<StoredCheck, "sentAt" | "refused">): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(CHECKS, "readwrite");
    const store = tx.objectStore(CHECKS);
    const check = (await done(store.get(id))) as StoredCheck | undefined;
    if (check) store.put({ ...check, ...patch });
    await finished(tx);
  });
}

export function getCheck(owner: string, id: string): Promise<StoredCheck | null> {
  return withDb(async (db) => {
    const check = (await done(db.transaction(CHECKS, "readonly").objectStore(CHECKS).get(id))) as StoredCheck | undefined;
    return check && check.owner === owner && check.status === "done" ? check : null;
  });
}

/** Which views of a check have a photo, without reading the photos. */
export function photoKeys(checkId: string): Promise<{ view: StoredPhoto["view"]; round: number }[]> {
  return withDb(async (db) => {
    const keys = (await done(db.transaction(PHOTOS, "readonly").objectStore(PHOTOS).index("checkId").getAllKeys(checkId))) as unknown as [
      string,
      StoredPhoto["view"],
      number,
    ][];
    return keys.map(([, view, round]) => ({ view, round }));
  });
}

/** A check's photos, only for its owner. */
export async function readPhotos(owner: string, checkId: string): Promise<StoredPhoto[]> {
  const check = await getCheck(owner, checkId);
  if (!check) return [];
  return withDb(async (db) => (await done(db.transaction(PHOTOS, "readonly").objectStore(PHOTOS).index("checkId").getAll(checkId))) as StoredPhoto[]);
}

async function removePhotos(store: IDBObjectStore, checkId: string): Promise<void> {
  const keys = await done(store.index("checkId").getAllKeys(checkId));
  for (const key of keys) store.delete(key);
}

export function deletePhotos(owner: string, checkId: string): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction([CHECKS, PHOTOS], "readwrite");
    const check = (await done(tx.objectStore(CHECKS).get(checkId))) as StoredCheck | undefined;
    if (!check || check.owner !== owner) return;
    await removePhotos(tx.objectStore(PHOTOS), checkId);
    tx.objectStore(CHECKS).put({ ...check, keepPhotos: false });
    await finished(tx);
  });
}

/** A check and its photos, gone from this phone. */
export function deleteCheck(owner: string, checkId: string): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction([CHECKS, PHOTOS], "readwrite");
    const check = (await done(tx.objectStore(CHECKS).get(checkId))) as StoredCheck | undefined;
    if (check && check.owner !== owner) return;
    await removePhotos(tx.objectStore(PHOTOS), checkId);
    tx.objectStore(CHECKS).delete(checkId);
    await finished(tx);
  });
}

/**
 * Tidy up after a check that never finished (the tab closed, the phone died):
 * its record and any photos it had kept, and any photo whose check is gone.
 * A check still running in another tab holds its lock and is left alone.
 */
export async function sweepAbandoned(owner: string, now = Date.now()): Promise<number> {
  // Asked before the transaction opens: awaiting anything but the database
  // inside it would let it close.
  const running = await runningNow();
  const abandoned = (c: StoredCheck) =>
    c.status === "running" &&
    // A check started after this sweep began is never its business.
    Date.parse(c.at) < now &&
    (running ? !running.has(c.id) : now - Date.parse(c.at) > ABANDONED_MS);
  return withDb(async (db) => {
    const tx = db.transaction([CHECKS, PHOTOS], "readwrite");
    const checks = tx.objectStore(CHECKS);
    const photos = tx.objectStore(PHOTOS);
    const mine = (await done(checks.index("owner").getAll(owner))) as StoredCheck[];
    let swept = 0;
    for (const c of mine) {
      if (abandoned(c)) {
        await removePhotos(photos, c.id);
        checks.delete(c.id);
        swept++;
      }
    }
    const known = new Set((await done(checks.getAllKeys())) as string[]);
    const photoKeysAll = (await done(photos.getAllKeys())) as unknown as [string, string, number][];
    for (const key of photoKeysAll) {
      if (!known.has(key[0])) {
        photos.delete(key);
        swept++;
      }
    }
    await finished(tx);
    return swept;
  });
}

/**
 * Ask the browser not to clear this site's storage when the phone runs short
 * of space. Chrome decides for itself and may say no; the photo switch's own
 * words cover that.
 */
export async function askToKeepStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

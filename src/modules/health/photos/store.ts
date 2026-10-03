import { POSES, type PhotoKey, type Pose } from "../core/photos";

/**
 * THE PHOTOS, KEPT ON THIS PHONE (H2b, ADR 0128). The browser's own storage
 * for this site, IndexedDB `yosher-health-photos`: one record a day and pose,
 * keyed `[owner, day, pose]`, so a photo taken again that day replaces the
 * last. `owner` is the personal space's id: two people signed in on one phone
 * never see each other's. Nothing here sends anything, and nothing reads a
 * picture's bytes but the screens that draw it (`draw.ts`).
 *
 * A record can come back for the wrong space only if this file asks for one,
 * so every read names the owner.
 */

const DB_NAME = "yosher-health-photos";
const DB_VERSION = 1;
const STORE = "photos";

export interface KeptPhoto {
  owner: string;
  /** The space's day it was taken on. */
  day: string;
  pose: Pose;
  /** The JPEG. */
  blob: Blob;
  width: number;
  height: number;
  /** When it was taken, ms since the epoch, on the phone's clock. */
  at: number;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The phone's storage refused."));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("The phone's storage refused."));
    tx.onerror = () => reject(tx.error ?? new Error("The phone's storage refused."));
  });
}

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ["owner", "day", "pose"] });
        store.createIndex("owner", "owner");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the database, or a person clearing it: let go at
      // once, and open afresh next time. Held open, it blocks both (the drive
      // found a delete left waiting on Body's card).
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error("The phone's storage could not be opened."));
    };
  });
  return opening;
}

/**
 * Keep these, in one go: all of them or none. A day and pose already kept is
 * replaced. Stamped with the phone's time here, not in a screen (React's
 * compiler keeps the clock out of components).
 */
export async function keepPhotos(photos: readonly Omit<KeptPhoto, "at">[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const at = Date.now();
  for (const photo of photos) store.put({ ...photo, at });
  await done(tx);
}

/** Which days and poses this space has, without reading a picture. */
export async function photoKeys(owner: string): Promise<PhotoKey[]> {
  const db = await openDb();
  const keys = await request(db.transaction(STORE).objectStore(STORE).index("owner").getAllKeys(IDBKeyRange.only(owner)));
  return keys
    .filter((k): k is [string, string, Pose] => Array.isArray(k) && k.length === 3 && k[0] === owner)
    .map(([, day, pose]) => ({ day, pose }));
}

/** One photo, or null. */
export async function photoOf(owner: string, day: string, pose: Pose): Promise<KeptPhoto | null> {
  const db = await openDb();
  const found = (await request(db.transaction(STORE).objectStore(STORE).get([owner, day, pose]))) as KeptPhoto | undefined;
  return found && found.owner === owner ? found : null;
}

/** The newest photo of a pose before a day, for the outline to line up with; null when there is none. */
export async function lastPhotoOf(owner: string, pose: Pose, before: string): Promise<KeptPhoto | null> {
  const days = (await photoKeys(owner)).filter((k) => k.pose === pose && k.day < before).map((k) => k.day).sort();
  const day = days.at(-1);
  return day ? photoOf(owner, day, pose) : null;
}

/** The latest day with any photo, or null. */
export async function lastPhotoDay(owner: string): Promise<string | null> {
  const days = (await photoKeys(owner)).map((k) => k.day).sort();
  return days.at(-1) ?? null;
}

/** Take a day's photos off this phone, every pose. */
export async function deletePhotoDay(owner: string, day: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const pose of POSES) store.delete([owner, day, pose]);
  await done(tx);
}

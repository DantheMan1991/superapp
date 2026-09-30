import type { ViewCapture } from "../core/measures";
import type { View } from "../core/sticker-map";

/**
 * WHAT A POSTURE CHECK KEEPS ON THE PHONE (ADR 0118; docs/modules/posture.md,
 * slice 2). One database in the browser's own storage for this site, opened
 * the same way by the page and by the worker:
 *
 * - `checks`: each check's numbers (where each sticker and pose point sat in
 *   each view, the level, the scale). Until slice 3 saves them to the account,
 *   this is the only copy, and the report is rebuilt from them each time.
 * - `photos`: one picture per view of the first round, only when the person
 *   turned on "Keep a photo of each view on this phone". Written by the worker
 *   (`worker/photo-writer.ts`), so no picture ever crosses to the page by
 *   message; read back by the report, behind a tap. Never sent, never in the
 *   gallery, gone with the site's data or the phone.
 *
 * Works in a window and in a worker: nothing here touches the page.
 */

export const POSTURE_DB = "yosher-posture";
const VERSION = 1;
export const CHECKS = "checks";
export const PHOTOS = "photos";

export type StoredCheck = {
  id: string;
  /**
   * The personal space the check belongs to. The storage is the browser's,
   * not the person's: a second person signed in on this browser sees only
   * their own checks.
   */
  owner: string;
  /** When the check started, ISO. */
  at: string;
  status: "running" | "done";
  keepPhotos: boolean;
  captures: ViewCapture[];
  /** What happened on the way, in words: a plumb line not found, a view skipped. */
  notes: string[];
  version: 1;
  /**
   * When the account said it had the check's numbers (slice 3); missing or
   * null until then. The photos are never sent.
   */
  sentAt?: string | null;
  /** The account's last refusal, when it answered with one rather than not at all. */
  refused?: string | null;
};

export type StoredPhoto = {
  checkId: string;
  view: View;
  round: number;
  /** A JPEG, smaller than the camera's frame (`scale`). */
  blob: Blob;
  width: number;
  height: number;
  /** Photo pixels per frame pixel, so the check's points land on it. */
  scale: number;
  at: string;
};

/** A request's result, as a promise. */
export function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("posture storage: request failed"));
  });
}

/** A transaction's end, as a promise. */
export function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("posture storage: transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("posture storage: transaction aborted"));
  });
}

export function openPostureDb(): Promise<IDBDatabase> {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return Promise.reject(new Error("This browser keeps nothing on the phone (no IndexedDB)."));
  return new Promise((resolve, reject) => {
    const request = factory.open(POSTURE_DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHECKS)) {
        db.createObjectStore(CHECKS, { keyPath: "id" }).createIndex("owner", "owner");
      }
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS, { keyPath: ["checkId", "view", "round"] }).createIndex("checkId", "checkId");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer tab upgrading the database: let it, and open again next time.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("posture storage: could not open"));
  });
}

/**
 * A PHOTO OF THE PLATE, HANDED FROM TODAY TO LOG FOOD (the redesign's camera
 * buttons, ADR 0132). Today has the camera; Log food reads the photo and has
 * the person check what was found. The file crosses in this module's memory:
 * a client-side navigation keeps it, so Log food takes it on arrival and
 * starts reading. A reload in between loses it, and Log food opens as it
 * always does, with its own Photo of the plate. Nothing is stored.
 */

let waiting: File | null = null;

export function handPlatePhoto(file: File): void {
  waiting = file;
}

/** Whether a photo is waiting, without taking it: for Log food's first render. */
export function hasPlatePhoto(): boolean {
  return waiting !== null;
}

/** The waiting photo, once. */
export function takePlatePhoto(): File | null {
  const file = waiting;
  waiting = null;
  return file;
}

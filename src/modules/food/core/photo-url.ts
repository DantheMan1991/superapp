/**
 * A RECIPE PHOTO'S ADDRESS. Pure and import-free, so a list that shows a
 * recipe's photo beside what was eaten (Today, Log food, the week) can build
 * it without the blob store that `photo-ops.ts` brings. The photo route is the
 * authorization: it reads the recipe under the person's RLS before streaming.
 */

/** A short version for a photo's URL, from its pathname: a new photo is a new URL, so the browser may keep each. */
export function photoVersion(pathname: string): string {
  let hash = 0;
  for (let i = 0; i < pathname.length; i += 1) hash = (hash * 31 + pathname.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function recipePhotoUrl(recipeId: string, pathname: string): string {
  return `/personal/m/food/recipes/${recipeId}/photo?v=${photoVersion(pathname)}`;
}

/** A recipe's photo, or null when it has none. */
export function recipePhotoOrNull(recipeId: string | null | undefined, pathname: string | null | undefined): string | null {
  return recipeId && pathname ? recipePhotoUrl(recipeId, pathname) : null;
}

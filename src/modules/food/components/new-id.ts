/**
 * A new id for a row the phone names, so an Add sent twice is kept once. Here,
 * outside every component, because the React compiler holds a component's
 * render (and the handlers it defines) to be pure (the cook store's rule, D1b).
 */
export function newId(): string {
  return crypto.randomUUID();
}

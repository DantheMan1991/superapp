/**
 * The PIN a shared device punches with. **PURE — no imports.**
 *
 * ── WHAT A PIN IS, AND WHAT IT IS NOT ────────────────────────────────────────
 *
 * It is not a password, and treating it as one would be the first mistake. The
 * tablet by the barn door is already signed in — a supervisor's session opened
 * it, and `requireTenant()` has already said this browser may write time for
 * this business. The PIN answers the SECOND question, which is **which of you
 * is standing here**. It identifies; the Clerk session authorises.
 *
 * That is why four digits is enough, and why it may be the same four digits as
 * somebody else's: nobody types a PIN until they have tapped their own name, so
 * two workers sharing `4821` is not a collision, it is a coincidence nothing
 * ever has to resolve. The alternative — type a PIN and let the server work out
 * who you are — needs PINs to be unique across the business, leaks "that one is
 * taken" while setting one, and costs a scrypt verification per worker on every
 * keypress. One extra tap buys all three problems away.
 *
 * It still gets hashed with scrypt and rate-limited, because "only identifies"
 * is not "does not matter": punching a colleague in is wage fraud, and it is the
 * exact fraud a shared clock invites.
 */

/** Short enough to type with gloves on, long enough not to be guessed at once. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

/** Wrong tries before a worker's PIN stops answering. */
export const MAX_PIN_FAILURES = 5;

/**
 * How long it stays shut, in minutes.
 *
 * **IT EXPIRES BY ITSELF, and that is the whole point.** Documents' share links
 * lock until an owner resets them, which is right for a link to a stranger and
 * wrong here: the person locked out is standing in a barn at six in the morning
 * and the owner is in a field. Fifteen minutes ends a guessing spree and costs
 * an honest fat-fingered worker one cup of coffee. An owner can still clear it
 * sooner, and a supervisor can log the hours by hand either way.
 */
export const PIN_LOCKOUT_MINUTES = 15;

/** Digits only. Nothing else survives a numeric keypad with gloves on. */
export function isPin(raw: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(raw);
}

/**
 * A PIN anybody would guess first.
 *
 * Refused at the point somebody CHOOSES one, never at the point they type it —
 * telling a guesser "that is too obvious" would confirm it is not the PIN.
 * Repeats and straight runs in both directions cover what people actually pick;
 * this is not a strength meter and should not grow into one.
 */
export function isWeakPin(raw: string): boolean {
  if (!isPin(raw)) return false;
  if (new Set(raw).size === 1) return true; // 0000, 7777
  const digits = [...raw].map(Number);
  const step = digits[1] - digits[0];
  if (step === 1 || step === -1) {
    return digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
  }
  return false;
}

/**
 * When a worker's PIN starts answering again, or null if it is answering now.
 *
 * DERIVED, never stored — the shape a share link's status uses. A column
 * holding "locked" is a second copy of a fact the counter and the timestamp
 * already carry, and the two drift the moment one write updates one of them.
 */
export function pinLockedUntil(
  failedCount: number,
  failedAt: Date | null,
): Date | null {
  if (failedCount < MAX_PIN_FAILURES || !failedAt) return null;
  return new Date(failedAt.getTime() + PIN_LOCKOUT_MINUTES * 60 * 1000);
}

/** Is this worker's PIN shut right now? */
export function isPinLocked(
  failedCount: number,
  failedAt: Date | null,
  now: Date,
): boolean {
  const until = pinLockedUntil(failedCount, failedAt);
  return until !== null && until.getTime() > now.getTime();
}

/** "3 minutes" — what the keypad says while it is waiting. */
export function lockoutRemaining(until: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60000));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

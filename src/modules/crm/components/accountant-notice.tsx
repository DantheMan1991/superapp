/**
 * What an accountant is told, instead of a control that fails.
 *
 * ONE SENTENCE, ONCE PER SCREEN, at the top. The alternative — disabling every
 * control and letting the reader work out why — makes twelve screens argue with
 * the reader twelve times and explains nothing. Every `gate()` in this module
 * refuses `expert` (see `roleMayWrite` in `core/errors.ts`), so there is no
 * partial state to describe: the answer is the same everywhere and it is worth
 * saying plainly.
 *
 * A server component with no props but `what`: nothing here is interactive, and
 * the surrounding screens are server components already.
 */
export function AccountantNotice({ what }: { what: string }) {
  return (
    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
      Accountant access is read-only. You can see {what}, and nothing here can be
      changed.
    </p>
  );
}

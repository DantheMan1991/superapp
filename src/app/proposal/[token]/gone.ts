/**
 * The one page a visitor sees when a link does not open, whatever the reason
 * (E5c, ADR 0085).
 *
 * **It says nothing.** Revoked, expired, mistyped, never existed, already
 * accepted, estimate revised, business gone — all of them land here with the
 * same sentence, because any difference between them is something a stranger
 * could learn from. The builder is told which it is on their own screen,
 * where they are signed in.
 *
 * Unbranded on purpose for the same reason: a page that showed the business's
 * logo would confirm that the token belonged to that business.
 */
export function goneHtml(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not available</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #f3f4f6; color: #111827;
         font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 30rem; margin: 16px; padding: 32px; background: #fff; border-radius: 10px; text-align: center;
         box-shadow: 0 1px 3px rgba(0,0,0,.14), 0 8px 24px rgba(0,0,0,.06); }
  p { margin: 0 0 10px; }
  .muted { color: #6b7280; font-size: 13px; margin: 0; }
</style></head>
<body><main>
  <p>${safe}</p>
  <p class="muted">If you were expecting to see a proposal, ask the person who sent you the link for a new one.</p>
</main></body></html>`;
}

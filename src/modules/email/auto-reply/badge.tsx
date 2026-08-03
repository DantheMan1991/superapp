import Link from "next/link";
import { CalendarClock, PlaneTakeoff } from "lucide-react";
import { cn } from "@/lib/utils";
import { mailHref } from "../components/mail-panes";
import type { AutoReplyState } from "./validate";

/**
 * Whether an auto-reply is going out, said in the header.
 *
 * The reason this is a badge and not a settings link: an out-of-office reply
 * is the only thing in this product that talks to customers with nobody
 * present, and the way it goes wrong is never "it failed to send" — it is
 * somebody getting back from a week away and leaving it on for a fortnight.
 * So the ON state is loud, and the off state is a quiet way in.
 *
 * "Scheduled" and "ended" get their own treatment because `isEnabled` answers
 * a different question from "is this replying to anyone right now". A reply
 * that has been enabled since March with a window that closed in April is
 * both on and inert, and calling that "On" is how somebody believes their
 * customers are being answered when they are not.
 */
export function AutoReplyBadge({
  state,
  params,
}: {
  state: AutoReplyState | null;
  params: Record<string, string | undefined>;
}) {
  // Null means the mail server would not answer. Say nothing rather than
  // claiming the reply is off, which is a statement we cannot support.
  if (state === null) return null;

  const href = mailHref(params, {
    away: "1",
    // Clears EVERY other pane. Without this, opening one from the other leaves
    // ?away=1&rules=1 in the URL asking for both at once — and the render order
    // in MailView silently decides which one you get, so the badge looks dead.
    // `signature` was missing here until templates were added and made the same
    // bug reachable from a second direction.
    rules: undefined,
    signature: undefined,
    templates: undefined,
    compose: undefined,
    message: undefined,
  });

  if (state.state === "active") {
    return (
      <Link
        href={href}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
          "border-amber-300 bg-amber-50 text-amber-900",
          "dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
        )}
      >
        <PlaneTakeoff className="size-3.5" />
        <span>
          Auto-reply on
          {state.until
            ? ` until ${state.until.toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}`
            : ""}
        </span>
      </Link>
    );
  }

  if (state.state === "scheduled" || state.state === "ended") {
    return (
      <Link
        href={href}
        className="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <CalendarClock className="size-3.5" />
        <span>
          {state.state === "scheduled"
            ? `Auto-reply from ${state.from.toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}`
            : "Auto-reply finished"}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="hidden shrink-0 text-xs text-muted-foreground hover:text-foreground sm:block"
    >
      Auto-reply
    </Link>
  );
}

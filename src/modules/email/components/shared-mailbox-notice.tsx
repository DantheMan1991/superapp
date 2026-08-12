import { Users } from "lucide-react";

/**
 * "This applies to everyone", on the two settings where it does.
 *
 * The auto-reply and the signature are SINGLETONS PER ACCOUNT on the mail
 * server — a VacationResponse and an Identity — so on a shared mailbox there is
 * exactly one of each and whoever saves last has set it for the whole business.
 * `npm run mail:probe-delegation` confirmed a delegate can write both.
 *
 * They are still ALLOWED, unlike rules, and the difference is worth stating
 * because it looks arbitrary otherwise: neither has a per-user table of ours to
 * contradict, and both are the sort of thing a shared box genuinely needs —
 * "info@ is closed until Monday" is the case an auto-reply exists for. Rules
 * are refused because `mail_rules` IS per-user, so the record would be private
 * while the effect was public, and the next colleague to publish would silently
 * overwrite. See `rules/actions.ts`.
 *
 * A notice rather than a confirmation step: it is reversible, visible in the
 * form it applies to, and a dialog on every save would be noise by the third
 * time. What matters is that nobody edits this believing it is theirs.
 */
export function SharedMailboxNotice({
  address,
  what,
}: {
  address: string;
  /** "auto-reply" / "signature" — read as "This <what> belongs to…". */
  what: string;
}) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs">
      <Users className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">
          {address} is a shared mailbox.
        </span>{" "}
        The mail server keeps one {what} per mailbox, so saving this sets it for
        everyone who uses this address — and replaces whatever a colleague set.
      </p>
    </div>
  );
}

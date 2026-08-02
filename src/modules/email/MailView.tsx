import Link from "next/link";
import { AlertTriangle, Mail, PenSquare, Search } from "lucide-react";
import type { MailAccount } from "@/db/schema";
import type { TenantContext } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { withTenant } from "@/db";
import { loadMailView, visibleFolders } from "./read";
import { FolderRail, mailHref } from "./components/mail-panes";
import { ThreadList } from "./components/thread-list";
import { FilterBar } from "./components/filter-bar";
import { readMailView, isEmptyView } from "./organise/filters";
import { listSavedSearches } from "./organise/saved-searches";
import { ReadingPane } from "./components/reading-pane";
import { MailSearch } from "./components/mail-search";
import { MailPoller } from "./components/mail-poller";
import { Composer, type ComposeMode } from "./components/composer";
import { AutoReplyBadge } from "./auto-reply/badge";
import { AutoReplyForm } from "./auto-reply/form";
import { loadAutoReply } from "./auto-reply/load";
import { autoReplyState } from "./auto-reply/validate";
import { RulesEditor, type EditorRule } from "./rules/editor";
import { loadRules } from "./rules/load";
import { SignatureForm } from "./signature/form";
import { loadSignature } from "./signature/load";

/**
 * The three panes.
 *
 * Folder rail, thread list, reading pane — all server components, all driven by
 * the URL. Nothing here holds client state, so a view can be linked, reloaded
 * and reached with the back button, and the reading pane needs no client fetch
 * because the message came from the same load that built the list.
 *
 * The layout is a grid rather than three scrollable columns on small screens:
 * below `lg` the rail collapses to a horizontal strip and the panes stack, so
 * the whole thing works one-handed on a phone.
 */
export async function MailView({
  ctx,
  account,
  searchParams,
}: {
  ctx: TenantContext;
  account: MailAccount;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const first = (key: string): string | undefined => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const params = {
    mailbox: first("mailbox"),
    message: first("message"),
    q: first("q"),
    pos: first("pos"),
    // Per-message and per-visit: unblocking images is a decision the reader
    // makes each time, not a preference stored against a sender.
    images: first("images"),
    // In the URL like everything else, so a half-written reply survives the
    // page around it refreshing.
    compose: first("compose"),
    unread: first("unread"),
    flagged: first("flagged"),
    attach: first("attach"),
    away: first("away"),
    rules: first("rules"),
    signature: first("signature"),
  };
  const viewQuery = readMailView(params);
  const position = Number(params.pos ?? "0");
  const composeMode = readComposeMode(params.compose);
  const showAway = params.away === "1";
  const showRules = params.rules === "1";
  const showSignature = params.signature === "1";

  const view = await loadMailView(account, {
    tenantId: ctx.tenant.id,
    clerkUserId: ctx.userId,
    ...(params.mailbox ? { mailboxId: params.mailbox } : {}),
    ...(params.message ? { messageId: params.message } : {}),
    view: viewQuery,
    position: Number.isFinite(position) && position > 0 ? position : 0,
    ...(composeMode ? { composing: true } : {}),
  });

  if (!view.ok) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <AlertTriangle className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">{view.message}</p>
        {view.needsReauth && (
          <Button asChild className="mt-4" size="sm">
            <a
              href={`/api/email/oauth/start?mailboxId=${encodeURIComponent(account.mailboxId)}`}
            >
              Reconnect this mailbox
            </a>
          </Button>
        )}
      </div>
    );
  }

  const folders = visibleFolders(view.folders);
  const searching = Boolean(params.q);
  const selectedFolder = folders.find((f) => f.id === view.mailboxId) ?? null;
  const archiveFolder = view.folders.find((f) => f.role === "archive");
  const trashFolder = view.folders.find((f) => f.role === "trash");
  /**
   * Where a snoozed message comes BACK to: the folder being viewed, so
   * deferring something out of a project folder returns it there rather than
   * into a pile with everything else.
   *
   * A SEARCH has no folder — `view.mailboxId` is null — and results can span
   * every folder in the account. The inbox is the honest fallback: it is where
   * the message would have been looked for anyway, and guessing per-message
   * would need a round trip to ask the server where each one currently lives.
   */
  const snoozeReturnFolderId =
    view.mailboxId ?? view.folders.find((f) => f.role === "inbox")?.id ?? null;

  // Saved views are per-user (drizzle/0048), so this read MUST carry userId —
  // without it the policy matches nothing and the rail silently shows none.
  const savedSearches = await withTenant(
    ctx.tenant.id,
    (tx) => listSavedSearches(tx, ctx.tenant.id, account.id),
    { role: ctx.role, userId: ctx.userId },
  );

  /**
   * The out-of-office setting, read on every mail page load.
   *
   * One extra JMAP call, and worth it. An auto-reply is the only setting in
   * this product that speaks to customers with nobody present, and the failure
   * that matters is forgetting it is on. Reading it only when the form is open
   * would mean the badge could never appear — and the badge is the feature.
   *
   * A failure is swallowed to null. The mail server declining to answer a
   * question about holidays is not a reason to refuse somebody their inbox.
   */
  /**
   * Only when the editor is open, unlike the auto-reply read above. Rules have
   * no badge and no consequence anybody needs to see from the inbox — the
   * script is already running on the mail server whether or not this page
   * knows about it.
   */
  const rules: EditorRule[] = showRules
    ? (await loadRules(ctx.tenant.id, ctx.userId, ctx.role, account.id)).map(
        (row): EditorRule => {
          const action = (row.action ?? {}) as Record<string, unknown>;
          return {
            name: row.name,
            isEnabled: row.isEnabled,
            matchMode: row.matchMode === "any" ? "any" : "all",
            tests: Array.isArray(row.tests)
              ? (row.tests as EditorRule["tests"])
              : [],
            fileIntoMailboxId:
              typeof action.fileIntoMailboxId === "string"
                ? action.fileIntoMailboxId
                : null,
            fileIntoName:
              typeof action.fileIntoName === "string" ? action.fileIntoName : null,
            markRead: action.markRead === true,
            flag: action.flag === true,
            stopAfter: row.stopAfter,
          };
        },
      )
    : [];

  /**
   * Only when the editor is open, like the rules and unlike the auto-reply
   * setting. A signature needs no badge: it is not a state that can be wrong in
   * the background, so paying a round trip for it on every inbox render would
   * be a cost every reader carries for a thing only writers change.
   */
  const signature = showSignature ? await loadSignature(account) : null;

  const away = await loadAutoReply(account);
  const awayState = away
    ? autoReplyState(
        { isEnabled: away.isEnabled, fromDate: away.fromDate, toDate: away.toDate },
        new Date(),
      )
    : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col lg:h-screen">
      {/* Mounted here, on the mail route only — never in the dashboard layout,
          or every page in the product would poll a mail server. */}
      <MailPoller mailboxId={account.mailboxId} />

      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <Mail className="size-5 shrink-0 text-brand" />
        <span className="truncate text-sm font-medium">Mail</span>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link href={mailHref(params, { compose: "new", message: undefined })}>
            <PenSquare className="size-4" />
            <span className="hidden sm:inline">Write</span>
          </Link>
        </Button>
        {/* Reads as status, not as a settings link: when a reply is going out
            on your behalf, that is the single most important thing on this
            screen, and it must be visible without opening anything. */}
        <AutoReplyBadge state={awayState} params={params} />
        <Link
          href={mailHref(params, { rules: "1", away: undefined, signature: undefined, compose: undefined, message: undefined })}
          className="hidden shrink-0 text-xs text-muted-foreground hover:text-foreground sm:block"
        >
          Rules
        </Link>
        <Link
          href={mailHref(params, { signature: "1", away: undefined, rules: undefined, compose: undefined, message: undefined })}
          className="hidden shrink-0 text-xs text-muted-foreground hover:text-foreground sm:block"
        >
          Signature
        </Link>
        <MailSearch initial={params.q ?? ""} params={params} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[13rem_22rem_minmax(0,1fr)]">
        {/* Rail: a horizontal scroller on phones, a column on desktop. */}
        <aside className="min-h-0 overflow-auto border-b lg:border-r lg:border-b-0">
          <FolderRail
            folders={folders}
            selectedId={view.mailboxId}
            params={params}
            mailboxId={account.mailboxId}
            savedSearches={savedSearches}
          />
        </aside>

        {/* On phones only one of list/message shows, so the pane in view fills
            the screen instead of both being half-height. */}
        <section
          className={`min-h-0 overflow-auto border-b lg:border-r lg:border-b-0 ${
            view.message ? "hidden lg:block" : "block"
          }`}
        >
          <FilterBar
            view={viewQuery}
            params={params}
            mailboxId={account.mailboxId}
            folderName={selectedFolder?.name ?? null}
            canSave={!isEmptyView(viewQuery)}
          />
          {searching && (
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">
              {view.total === null
                ? "Results across all folders"
                : `${view.total} result${view.total === 1 ? "" : "s"} across all folders`}{" "}
              ·{" "}
              <Link href={mailHref(params, { q: undefined, pos: undefined })} className="underline">
                clear
              </Link>
            </p>
          )}
          <ThreadList
            rows={view.rows}
            selectedId={params.message}
            params={params}
            emptyMessage={
              searching
                ? "Nothing matched that search."
                : "Nothing here yet. New mail will appear as it arrives."
            }
            mailboxId={account.mailboxId}
            archiveFolderId={archiveFolder?.id ?? null}
            trashFolderId={trashFolder?.id ?? null}
            snoozeReturnFolderId={snoozeReturnFolderId}
          />
          {view.rows.length > 0 && (
            <Pager params={params} position={view.position} total={view.total} count={view.rows.length} />
          )}
        </section>

        <section
          className={`min-h-0 ${view.message || composeMode || showAway || showRules || showSignature ? "block" : "hidden lg:block"}`}
        >
          {showSignature ? (
            <SignatureForm
              mailboxId={account.mailboxId}
              signature={signature}
              closeHref={mailHref(params, { signature: undefined })}
            />
          ) : showRules ? (
            <RulesEditor
              mailboxId={account.mailboxId}
              folders={folders}
              initial={rules}
              closeHref={mailHref(params, { rules: undefined })}
            />
          ) : showAway ? (
            // Same choice the composer made: it takes the pane rather than
            // floating over it, so the inbox stays visible behind the decision.
            <AutoReplyForm
              mailboxId={account.mailboxId}
              unavailable={away === null}
              initial={{
                isEnabled: away?.isEnabled ?? false,
                fromDate: toLocalInput(away?.fromDate ?? null),
                toDate: toLocalInput(away?.toDate ?? null),
                subject: away?.subject ?? "",
                textBody: away?.textBody ?? "",
              }}
              closeHref={mailHref(params, { away: undefined })}
            />
          ) : composeMode ? (
            // The composer takes the reading pane rather than floating over it:
            // a modal that covers the message you are replying to is the thing
            // every mail client eventually regrets.
            <Composer
              mailboxId={account.mailboxId}
              accountId={account.id}
              selfAddress={view.selfAddress}
              mode={composeMode}
              parent={view.message}
              signature={view.signature}
              htmlSignature={view.htmlSignature}
              closeHref={mailHref(params, { compose: undefined })}
            />
          ) : view.message ? (
            <>
              <div className="border-b px-4 py-2 lg:hidden">
                <Link
                  href={mailHref(params, { message: undefined })}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  ← Back to list
                </Link>
              </div>
              <ReadingPane
                ctx={ctx}
                message={view.message}
                accountId={account.id}
                mailboxId={account.mailboxId}
                folders={view.folders}
                showImages={params.images === "1"}
                showImagesHref={mailHref(params, { images: "1" })}
                replyHref={mailHref(params, { compose: "reply" })}
                replyAllHref={mailHref(params, { compose: "reply_all" })}
                forwardHref={mailHref(params, { compose: "forward" })}
              />
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <Search className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Pick a message to read it.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** `?compose=` → a mode, or nothing. An unknown value opens no composer. */
function readComposeMode(raw: string | undefined): ComposeMode | null {
  switch (raw) {
    case "new":
    case "reply":
    case "reply_all":
    case "forward":
      return raw;
    default:
      return null;
  }
}

const PAGE = 40;

/**
 * Prev/next rather than "load more": a mail list is something people move
 * through in both directions, unlike a document browser that only grows.
 */
function Pager({
  params,
  position,
  total,
  count,
}: {
  params: Record<string, string | undefined>;
  position: number;
  total: number | null;
  count: number;
}) {
  const hasPrev = position > 0;
  const hasNext = total === null ? count === PAGE : position + count < total;
  if (!hasPrev && !hasNext) return null;

  return (
    <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
      {hasPrev ? (
        <Link
          href={mailHref(params, {
            pos: String(Math.max(0, position - PAGE)),
            message: undefined,
          })}
          className="text-muted-foreground hover:text-foreground"
        >
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      {hasNext ? (
        <Link
          href={mailHref(params, {
            pos: String(position + PAGE),
            message: undefined,
          })}
          className="text-muted-foreground hover:text-foreground"
        >
          Older →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}

/**
 * An absolute instant back into what `datetime-local` wants: wall-clock time
 * with no zone, in the viewer's zone. Losing the trailing "Z" is the point —
 * the input has no concept of one, and appending it would shift every date by
 * the user's offset every time the form is opened and saved.
 */
function toLocalInput(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(
    parsed.getDate(),
  )}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

import Link from "next/link";
import { AlertTriangle, Mail, PenSquare, Search } from "lucide-react";
import type { MailAccount } from "@/db/schema";
import type { TenantContext } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { loadMailView, visibleFolders } from "./read";
import { FolderRail, ThreadList, mailHref } from "./components/mail-panes";
import { ReadingPane } from "./components/reading-pane";
import { MailSearch } from "./components/mail-search";
import { MailPoller } from "./components/mail-poller";
import { Composer, type ComposeMode } from "./components/composer";

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
  };
  const position = Number(params.pos ?? "0");
  const composeMode = readComposeMode(params.compose);

  const view = await loadMailView(account, {
    tenantId: ctx.tenant.id,
    clerkUserId: ctx.userId,
    ...(params.mailbox ? { mailboxId: params.mailbox } : {}),
    ...(params.message ? { messageId: params.message } : {}),
    ...(params.q ? { query: params.q } : {}),
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
        <MailSearch initial={params.q ?? ""} params={params} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[13rem_22rem_minmax(0,1fr)]">
        {/* Rail: a horizontal scroller on phones, a column on desktop. */}
        <aside className="min-h-0 overflow-auto border-b lg:border-r lg:border-b-0">
          <FolderRail
            folders={folders}
            selectedId={view.mailboxId}
            params={params}
          />
        </aside>

        {/* On phones only one of list/message shows, so the pane in view fills
            the screen instead of both being half-height. */}
        <section
          className={`min-h-0 overflow-auto border-b lg:border-r lg:border-b-0 ${
            view.message ? "hidden lg:block" : "block"
          }`}
        >
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
          />
          {view.rows.length > 0 && (
            <Pager params={params} position={view.position} total={view.total} count={view.rows.length} />
          )}
        </section>

        <section
          className={`min-h-0 ${view.message || composeMode ? "block" : "hidden lg:block"}`}
        >
          {composeMode ? (
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

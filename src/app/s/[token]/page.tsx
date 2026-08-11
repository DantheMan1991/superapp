import { headers, cookies } from "next/headers";
import { FileText, FolderOpen, Lock } from "lucide-react";
import { hashIp, verifySession } from "@/lib/public-token";
import {
  countShareView,
  GENERIC_GONE,
  resolveShare,
} from "@/modules/documents/shares/resolve";
import { loadSharedContents } from "@/modules/documents/shares/contents";
import { recordShareEvent } from "@/modules/documents/shares/events";
import { formatBytes } from "@/modules/documents/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { UnlockForm } from "./unlock-form";

export const dynamic = "force-dynamic";

/**
 * The public face of a share link. No sign-in, no nav, no tenant data beyond
 * what was deliberately shared.
 *
 * Every failure — unknown token, revoked, expired, used up, locked, suspended,
 * module switched off, tenant gone, file trashed — renders the SAME page with
 * the SAME words. A visitor holding a dud token learns nothing about whether
 * it was ever real.
 */
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

function Gone() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">{GENERIC_GONE}</h1>
      <p className="text-sm text-muted-foreground">
        Links expire, and the sender can turn one off at any time. Ask whoever
        sent it for a new one.
      </p>
    </main>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ip = await clientIp();
  const ipHash = hashIp(ip);

  const resolved = await resolveShare(token, ipHash);
  if (!resolved.ok) return <Gone />;

  const { share, tenantName } = resolved;

  // A passcode is delivered out of band, so it is the one thing that must be
  // distinguishable — and it only reveals "some link exists" to someone who
  // already holds a 256-bit token.
  if (share.passcodeHash) {
    const jar = await cookies();
    const unlocked = verifySession(
      jar.get(`share_${share.id}`)?.value,
      share.id,
    );
    if (!unlocked) {
      return (
        <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
          <div className="flex items-center gap-2">
            <Lock className="size-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">This link needs a passcode</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {tenantName} sent you a passcode separately.
          </p>
          <UnlockForm token={token} />
        </main>
      );
    }
  }

  const contents = await loadSharedContents(share);
  if (!contents) return <Gone />;

  await countShareView(share.tenantId, share.id);
  await recordShareEvent({
    tenantId: share.tenantId,
    shareId: share.id,
    kind: "viewed",
    ipHash,
  });

  const expires = share.expiresAt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {/*
        Kept deliberately plain. This is the one page in the app that renders
        without a session — it is what a client's own customer sees — so it takes
        the token system (elevation, `--divider`) without the dashboard's rail,
        module accent or category strip. `--module-accent` is unset here, so
        `PageHeader`'s chip would fall back to the brand accent; no icon is
        passed, so nothing tinted appears at all.
      */}
      <header className="mb-6 border-b border-divider pb-4">
        <p className="text-sm text-muted-foreground">Shared by {tenantName}</p>
        <PageHeader
          className="mt-1"
          title={share.label || contents.rootName}
          description={
            <>
              This link stops working on {expires}.
              {!share.canDownload && " View only."}
            </>
          }
        />
      </header>

      {contents.files.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<FolderOpen />}
            title="Nothing here yet"
            description="Whoever shared this link has not added anything to it."
          />
        </Panel>
      ) : (
        <Panel>
          <ul className="divide-y divide-divider">
            {contents.files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
              >
                <FileText className="size-4 shrink-0 text-subtle-foreground" />
                <div className="min-w-0 flex-1">
                  <a
                    href={`/s/${encodeURIComponent(token)}/f/${file.id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {file.name}
                  </a>
                  <p className="text-xs text-subtle-foreground tabular-nums">
                    {formatBytes(file.sizeBytes)}
                  </p>
                </div>
                {share.canDownload && (
                  <a
                    href={`/s/${encodeURIComponent(token)}/f/${file.id}?download=1`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <footer className="mt-8 text-center text-xs text-muted-foreground">
        Shared securely with Yosher
      </footer>
    </main>
  );
}

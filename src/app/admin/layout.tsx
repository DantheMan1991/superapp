import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/app-shell";
import { AfterHydration } from "@/components/app/after-hydration";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { countReportsNeedingOperator } from "@/lib/feedback/read";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { userId } = await requireSuperAdmin();

  /*
    The number on the Feedback row. ONE count across every workspace, the
    console's twin of the dot on the client's report button (ADR 0053) — and
    the reason it is in the layout rather than on the page is that a report
    waiting three days must be visible from the Clients list, not only from the
    page that lists it.
  */
  const waitingFeedback = await countReportsNeedingOperator();

  // The god view is powerful — its use is logged.
  await logAudit({
    action: "admin.access",
    actorClerkUserId: userId,
    actorLabel: "god-view",
  });

  return (
    <AppShell
      contextLabel="Platform admin"
      navGroups={[
        {
          label: "Clients",
          items: [
            { href: "/admin", label: "Clients", icon: "users", exact: true },
            { href: "/admin/retainers", label: "Retainers", icon: "clock" },
            {
              href: "/admin/feedback",
              label: "Feedback",
              icon: "message",
              // The count, not an alert dot: unlike a mailbox that needs
              // reconnecting, we know exactly how many are waiting.
              badge: waitingFeedback,
            },
          ],
        },
        {
          label: "Platform",
          items: [
            { href: "/admin/modules", label: "Modules", icon: "boxes" },
          ],
        },
        {
          label: "Records",
          items: [
            { href: "/admin/docs", label: "Build docs", icon: "book" },
            { href: "/admin/audit", label: "Audit log", icon: "audit" },
          ],
        },
      ]}
      footer={
        <a
          href="/dashboard"
          className="block text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground"
        >
          Client view →
        </a>
      }
      /*
        Out of the drawer for the same reason the client shell's is: the mobile
        drawer is a modal dialog, and Clerk portals this popover to `body`
        where pointer events are disabled while it is open.
      */
      identity={
        // Same race as the client shell: see after-hydration.tsx.
        <AfterHydration>
          <UserButton />
        </AfterHydration>
      }
    >
      {children}
    </AppShell>
  );
}

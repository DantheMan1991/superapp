import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";
import { AppShell } from "@/components/app-shell";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { userId } = await requireSuperAdmin();

  // The god view is powerful — its use is logged.
  await logAudit({
    action: "admin.access",
    actorClerkUserId: userId,
    actorLabel: "god-view",
  });

  return (
    <AppShell
      contextLabel="Platform admin"
      navItems={[
        { href: "/admin", label: "Clients", icon: "users", exact: true },
        { href: "/admin/modules", label: "Modules", icon: "boxes" },
        { href: "/admin/audit", label: "Audit log", icon: "audit" },
      ]}
      footer={
        <div className="flex items-center justify-between">
          <UserButton />
          <a
            href="/dashboard"
            className="text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground"
          >
            Client view →
          </a>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}

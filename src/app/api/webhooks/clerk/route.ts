import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { logAudit } from "@/lib/audit";
import {
  markTenantChurned,
  removeMembership,
  upsertMembership,
  upsertProfileFromUser,
  upsertTenantFromOrg,
} from "@/lib/tenant-sync";

export const runtime = "nodejs";

/**
 * Clerk → DB sync. Signature-verified with svix; unverified payloads are
 * rejected before any parsing side effects.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CLERK_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const payload = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let evt: { type: string; data: any };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evt = new Webhook(secret).verify(payload, headers) as any;
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const { type, data } = evt;

  switch (type) {
    case "user.created":
    case "user.updated": {
      const primaryEmail =
        data.email_addresses?.find(
          (e: { id: string }) => e.id === data.primary_email_address_id,
        )?.email_address ?? data.email_addresses?.[0]?.email_address;
      if (primaryEmail) {
        await upsertProfileFromUser({
          id: data.id,
          email: primaryEmail,
          name:
            [data.first_name, data.last_name].filter(Boolean).join(" ") || null,
          imageUrl: data.image_url ?? null,
        });
      }
      break;
    }
    case "organization.created":
    case "organization.updated": {
      const tenant = await upsertTenantFromOrg({
        id: data.id,
        name: data.name,
        slug: data.slug,
      });
      if (type === "organization.created") {
        await logAudit({
          action: "tenant.created",
          tenantId: tenant.id,
          actorLabel: "clerk-webhook",
          meta: { clerkOrgId: data.id },
        });
      }
      break;
    }
    case "organization.deleted": {
      if (data.id) {
        await markTenantChurned(data.id);
        await logAudit({
          action: "tenant.churned",
          actorLabel: "clerk-webhook",
          meta: { clerkOrgId: data.id },
        });
      }
      break;
    }
    case "organizationMembership.created":
    case "organizationMembership.updated": {
      await upsertMembership({
        clerkOrgId: data.organization?.id,
        clerkUserId: data.public_user_data?.user_id,
        clerkRole: data.role,
      });
      break;
    }
    case "organizationMembership.deleted": {
      await removeMembership({
        clerkOrgId: data.organization?.id,
        clerkUserId: data.public_user_data?.user_id,
      });
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}

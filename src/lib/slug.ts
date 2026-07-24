import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import * as schema from "@/db/schema";

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "client"
  );
}

/** slugify + numeric-suffix dedupe against existing tenants (caller's tx). */
export async function uniqueTenantSlug(tx: Tx, name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const clash = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.slug, slug),
    });
    if (!clash) return slug;
    slug = `${base}-${i}`;
  }
}

import { desc, eq } from "drizzle-orm";
import { Sparkles, Trash2 } from "lucide-react";
import { withTenant, schema } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addHelloItem, deleteHelloItem } from "./actions";

/**
 * The stub module that certifies the shell: it renders only when activated
 * for the tenant, reads/writes tenant-scoped rows through RLS, and its
 * actions re-check authorization server-side.
 */
export async function HelloModule({ ctx }: { ctx: TenantContext }) {
  const items = await withTenant(ctx.tenant.id, (tx) =>
    tx.query.helloItems.findMany({
      where: eq(schema.helloItems.tenantId, ctx.tenant.id),
      orderBy: desc(schema.helloItems.createdAt),
      limit: 50,
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-brand/15 text-brand-foreground">
          <Sparkles className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Hello Module
          </h1>
          <p className="text-sm text-muted-foreground">
            Certifies activation, tenant scoping, and permissions — end to end.
          </p>
        </div>
        <Badge variant="secondary" className="ml-auto">
          system stub
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leave a note</CardTitle>
          <CardDescription>
            Notes are stored with your tenant ID and protected by row-level
            security. Another client can never see them — that&apos;s the whole
            point of this stub.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={addHelloItem} className="flex gap-2">
            <Input
              name="title"
              placeholder={`Hello from ${ctx.tenant.name}…`}
              maxLength={200}
              required
            />
            <Button type="submit">Add</Button>
          </form>

          <ul className="divide-y">
            {items.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">
                Nothing here yet. Add the first note above.
              </li>
            )}
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div>
                  <p className="text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.createdAt.toLocaleString()}
                  </p>
                </div>
                <form action={deleteHelloItem}>
                  <input type="hidden" name="id" value={item.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete note"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

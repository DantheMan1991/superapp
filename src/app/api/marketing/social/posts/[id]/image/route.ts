import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isPostShape } from "@/lib/social/posts";
import { postImageFileName, renderPostImage } from "@/modules/marketing/post-image";

export const runtime = "nodejs";

/**
 * A post's picture, cut to its shape — for the preview on the screen, and for
 * the owner to save and take to the network themselves (slice S1).
 *
 * **MEMBERS ONLY.** A post is not published by this build and its picture is
 * not on the internet: the tenant is resolved from the session and RLS proves
 * the row is theirs, so another tenant's post id returns the same 404 as no
 * post at all.
 *
 * `?download=1` sets `Content-Disposition: attachment`, which is what the Save
 * the picture button uses. Without it the same bytes render inline, which is
 * what the editor's preview uses — one route, because a second would be a
 * second place to get the crop right.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await params;
  const ctx = await resolveTenantContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const found = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [row] = await tx
        .select({
          shape: schema.socialPosts.shape,
          focusX: schema.socialPosts.focusX,
          focusY: schema.socialPosts.focusY,
          pathname: schema.siteImages.pathname,
          width: schema.siteImages.width,
          height: schema.siteImages.height,
        })
        .from(schema.socialPosts)
        // An INNER join, so a post with no photo is simply absent — the same
        // 404 as a post that is not this tenant's, and nothing to branch on.
        .innerJoin(
          schema.siteImages,
          and(
            eq(schema.siteImages.tenantId, schema.socialPosts.tenantId),
            eq(schema.siteImages.id, schema.socialPosts.imageId),
          ),
        )
        .where(and(eq(schema.socialPosts.tenantId, ctx.tenant.id), eq(schema.socialPosts.id, id)));
      return row ?? null;
    },
    { role: ctx.role },
  );
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });

  const shape = isPostShape(found.shape) ? found.shape : "square";
  let rendered;
  try {
    rendered = await renderPostImage(
      { pathname: found.pathname, width: found.width, height: found.height },
      shape,
      { x: found.focusX, y: found.focusY },
    );
  } catch (err) {
    console.error("post image render failed", err);
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(Buffer.from(rendered.bytes), {
    headers: {
      "Content-Type": rendered.mimeType,
      "Content-Length": String(rendered.bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${postImageFileName(shape)}"`,
      // Private and short: the bytes change the moment the owner moves the
      // focus or picks another shape, and both are one tap away.
      "Cache-Control": "private, max-age=60",
    },
  });
}

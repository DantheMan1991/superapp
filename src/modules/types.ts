import type { ReactNode } from "react";
import type { TenantContext } from "@/lib/auth";
import type { LabelDefinition } from "@/lib/packs/resolve";

/**
 * A module = a togglable feature rendered inside the client dashboard shell.
 * The DB `modules` table is the registry of what exists and is sellable;
 * this code-side definition is how an available module actually renders.
 * Industry templates (Layer 2) will later contribute their own definitions —
 * same seam, different package.
 */
/**
 * A NAMED PART OF A TOOL, which an access level can take away (ADR 0095).
 *
 * Declared HERE, beside the tool's own slug and icon, rather than in one
 * central list — so a pack built next year arrives with its areas, the way it
 * already arrives with its icon. A central list is a file somebody has to
 * remember to edit, and the icon registry is this codebase's own cautionary
 * tale: five packs shipped showing a generic box because nobody did.
 *
 * **THE TOOL'S FRONT DOOR IS NEVER AN AREA.** `/dashboard/m/jobs` belongs to no
 * area and is reachable by anybody who has the tool at all, so a level that
 * removes every area leaves a working screen rather than a tool whose only page
 * 404s.
 */
export interface AreaDefinition {
  /** The key's suffix: `reports` in `accounting:reports`. Stable, never shown. */
  key: string;
  /** What the owner ticks, in their words. */
  name: string;
  /**
   * Route segments under `/dashboard/m/<slug>/` this area owns. Defaults to
   * `[key]`, which is the ordinary case. The LONGEST match wins, so a nested
   * area can carve itself out of a broader one.
   */
  paths?: string[];
}

export interface ModuleDefinition {
  /** Must match modules.id in the DB. */
  slug: string;
  name: string;
  /** lucide icon name used in nav (kept as string to stay serializable). */
  icon: string;
  /**
   * How much width the module's pages want.
   *
   * "standard" (the default) keeps the shell's centred `max-w-content`
   * column, which is right for every reading-and-forms surface in the product. "full" hands
   * the module the whole viewport, for the one shape that genuinely needs it:
   * a list beside a detail pane, where the clamp would waste half a monitor.
   *
   * Declared here rather than matched by pathname in the shell, so the shell
   * never has to know a module's name to lay it out.
   */
  layout?: "standard" | "full";
  /**
   * Sub-paths (relative to `/dashboard/m/<slug>/`) that want the whole
   * viewport while the rest of the module keeps the standard column. For
   * one editor-shaped screen inside an ordinary module — Marketing's page
   * editor, a form beside a live preview — without widening every page of
   * the module. Same prefix test the shell uses for `layout: "full"`.
   */
  fullWidthPaths?: string[];
  /**
   * The parts of this tool an access level may take away (ADR 0095). Absent, or
   * empty, means the tool is all-or-nothing — which is honest for a one-screen
   * tool like Assets, and for Mail, whose whole surface is one mailbox.
   */
  areas?: AreaDefinition[];
  /**
   * Words this feature lets a tenant rename. Declared so the admin screen can
   * LIST what is customisable instead of somebody having to grep for
   * `labelFor`, and so a test can catch a key used but never declared.
   */
  labels?: LabelDefinition[];
  /**
   * Server component rendered at /dashboard/m/[slug].
   *
   * `searchParams` is already awaited. Modules that keep view state in the URL
   * — which is the house pattern — read it from here; ones that do not can
   * ignore it.
   */
  Component: (props: {
    ctx: TenantContext;
    searchParams: Record<string, string | string[] | undefined>;
  }) => Promise<ReactNode> | ReactNode;
}

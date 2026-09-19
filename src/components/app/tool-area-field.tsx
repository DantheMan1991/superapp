"use client";

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * WHAT A LEVEL CAN OPEN: the tools, and the parts of each one (ADR 0095).
 *
 * A nested list rather than the flat grid `PackField` draws, because the
 * question genuinely has two levels — *"Dave gets Accounting, but only
 * Purchases and the Inbox"* — and a flat list of sixty keys is a list nobody
 * reads.
 *
 * **THE TICK BOXES SAY WHAT SOMEBODY CAN OPEN. THE DATABASE STORES WHAT THEY
 * CANNOT.** The inversion happens in one place, in the screen that uses this,
 * for the reasons in `src/lib/access/can.ts`: ticked-is-allowed is the sentence
 * an owner is thinking, and stored-as-denied is what keeps a screen built next
 * year reachable rather than silently missing everywhere.
 *
 * **UNTICKING A TOOL TAKES ITS PARTS WITH IT**, here and in the stored list
 * (`normaliseDenied`). A level reading "no Accounting, but also no Reports" is
 * two ways of saying one thing, and the second goes stale the moment the tool
 * comes back.
 */

export interface ToolChoice {
  slug: string;
  name: string;
  areas: { key: string; name: string }[];
}

export function ToolAreaField({
  id,
  tools,
  picked,
  onPicked,
}: {
  id: string;
  tools: ToolChoice[];
  /** Keys that are ALLOWED: a tool slug, or `tool:area`. */
  picked: string[];
  onPicked: (next: string[]) => void;
}) {
  if (tools.length === 0) return null;

  const has = (key: string) => picked.includes(key);

  function toggleTool(tool: ToolChoice) {
    const keys = [tool.slug, ...tool.areas.map((a) => `${tool.slug}:${a.key}`)];
    // On, everything comes with it; off, everything goes. The middle state —
    // a tool on with some parts off — is reached by ticking the parts.
    onPicked(
      has(tool.slug)
        ? picked.filter((k) => !keys.includes(k))
        : [...new Set([...picked, ...keys])],
    );
  }

  function toggleArea(tool: ToolChoice, key: string) {
    const full = `${tool.slug}:${key}`;
    if (has(full)) {
      onPicked(picked.filter((k) => k !== full));
      return;
    }
    // Ticking a part necessarily turns the tool on: a part of a tool you
    // cannot open is not a state, it is a contradiction.
    onPicked([...new Set([...picked, tool.slug, full])]);
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>What they can open</Label>
      <div
        id={id}
        className="grid max-h-80 gap-3 overflow-y-auto rounded-lg border border-border p-3"
      >
        {tools.map((tool) => (
          <div key={tool.slug}>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox checked={has(tool.slug)} onCheckedChange={() => toggleTool(tool)} />
              {tool.name}
            </label>
            {/* The parts, only while the tool itself is on — a list of parts
                under a tool somebody cannot open is furniture. */}
            {tool.areas.length > 0 && has(tool.slug) && (
              <div className="mt-1 grid grid-cols-2 gap-1 pl-6">
                {tool.areas.map((area) => (
                  <label
                    key={area.key}
                    className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Checkbox
                      checked={has(`${tool.slug}:${area.key}`)}
                      onCheckedChange={() => toggleArea(tool, area.key)}
                    />
                    {area.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Tick what this level can open. Everything else is gone from their menu,
        and the page says it does not exist if they type the address. A
        tool&rsquo;s own front page stays whenever the tool is ticked, so they
        always land somewhere. Overview, their own hours and their own phone are
        always there.
      </p>
    </div>
  );
}

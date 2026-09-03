import type { Parent, PhrasingContent, Root, Text } from "mdast";
import { controlMarkers } from "./guides-core";

/**
 * Turns `{button:Approve}` and its siblings into `<guide-control>` elements.
 *
 * A remark plugin, so the markers become nodes the renderer can hand to a
 * React component; the alternative, raw HTML in the guide with `rehype-raw`
 * switched on, would open every doc the shared renderer draws to markup.
 *
 * Only text nodes are split, and never inside inline code, so a guide can
 * still show the literal `{button:...}` syntax by quoting it. Written as a
 * small walker rather than `unist-util-visit`: the package is present only as
 * somebody else's dependency, and a walk over `children` is nine lines.
 */
export function remarkGuideControls() {
  return (tree: Root) => {
    split(tree);
  };
}

function split(parent: Parent): void {
  const next: Parent["children"] = [];
  for (const child of parent.children) {
    if (child.type === "text") {
      next.push(...pieces(child));
      continue;
    }
    if ("children" in child) split(child);
    next.push(child);
  }
  parent.children = next;
}

function pieces(node: Text): PhrasingContent[] {
  const markers = controlMarkers(node.value);
  if (markers.length === 0) return [node];
  const out: PhrasingContent[] = [];
  let cursor = 0;
  for (const marker of markers) {
    if (marker.index > cursor) {
      out.push({ type: "text", value: node.value.slice(cursor, marker.index) });
    }
    // An mdast node type of our own: `mdast-util-to-hast` builds an element
    // from `hName`/`hProperties` for a type it does not know.
    out.push({
      type: "text",
      value: marker.raw,
      data: {
        hName: "guide-control",
        hProperties: {
          kind: marker.kind,
          label: marker.label,
          variant: marker.variant ?? undefined,
          icon: marker.icon ?? undefined,
        },
      },
    } as Text);
    cursor = marker.index + marker.raw.length;
  }
  if (cursor < node.value.length) {
    out.push({ type: "text", value: node.value.slice(cursor) });
  }
  return out;
}

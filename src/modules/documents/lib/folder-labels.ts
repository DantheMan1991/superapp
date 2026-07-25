/**
 * "Contracts / 2026 / Acme" labels for a set of folders.
 *
 * Derived from the materialized path rather than by walking parent pointers,
 * so it needs one flat list and no recursion. A folder whose ancestor is
 * invisible to the caller (RLS removed it) simply contributes fewer segments —
 * the label degrades, it never throws and never reveals a hidden name.
 */
export interface LabelledFolder {
  id: string;
  path: string;
  name: string;
}

export function buildFolderLabels<T extends LabelledFolder>(
  folders: readonly T[],
): Map<string, string> {
  const byPath = new Map(folders.map((f) => [f.path, f]));
  const labels = new Map<string, string>();

  for (const folder of folders) {
    const parts: string[] = [];
    let prefix = "";
    for (const segment of folder.path.split("/").filter(Boolean)) {
      prefix += `/${segment}/`;
      const node = byPath.get(prefix);
      if (node) parts.push(node.name);
    }
    labels.set(folder.id, parts.join(" / "));
  }
  return labels;
}

/** The same labels as a sorted list, for pickers. */
export function folderOptions<T extends LabelledFolder>(
  folders: readonly T[],
): Array<{ id: string; label: string }> {
  const labels = buildFolderLabels(folders);
  return folders
    .map((f) => ({ id: f.id, label: labels.get(f.id) ?? f.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

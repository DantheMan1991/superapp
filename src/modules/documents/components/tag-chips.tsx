import Link from "next/link";
import { Badge } from "@/components/ui/badge";

/**
 * Tag slugs rendered as their display names, each linking to the filtered list.
 *
 * Deliberately NOT a client component: a row of links needs no JavaScript, and
 * these appear on every file in every listing.
 *
 * `names` comes from the registry. A slug with no entry is still shown — as the
 * slug itself — because silently dropping it would hide a real inconsistency
 * from the only people who could fix it.
 */
export function TagChips({
  slugs,
  names,
  className,
}: {
  slugs: readonly string[];
  names: Record<string, string>;
  className?: string;
}) {
  if (slugs.length === 0) return null;
  return (
    <span className={className}>
      {slugs.map((slug) => (
        <Link
          key={slug}
          href={`/dashboard/m/documents/search?tag=${encodeURIComponent(slug)}`}
          className="mr-1 inline-block align-middle"
        >
          <Badge variant="outline" className="font-normal hover:bg-secondary">
            {names[slug] ?? slug}
          </Badge>
        </Link>
      ))}
    </span>
  );
}

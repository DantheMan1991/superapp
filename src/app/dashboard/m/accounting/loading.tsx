import { Skeleton } from "@/components/ui/skeleton";

/**
 * What an accounting page looks like while its data loads.
 *
 * Every accounting route rendered nothing until its server component
 * returned — on a phone on a slow connection, a blank wait of a second or two
 * between two pages that look alike. This is the shape they share: the title
 * and its line, the section strip, and a panel of rows. Nothing here is
 * content, so it never disagrees with what arrives.
 */
export default function AccountingLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="overflow-hidden rounded-2xl bg-card shadow-elevation-1">
        <div className="divide-y divide-divider">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

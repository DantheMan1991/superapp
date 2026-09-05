import type { ViewSummary } from "@/lib/sites/views-core";

/**
 * A month of the site's visitors: the totals, a bar a day, and a row a
 * page. Server-rendered, no library — thirty bars are thirty divs.
 */
export function VisitorsPanel({
  summary,
  titles,
}: {
  summary: ViewSummary;
  /** Page path → title, for the table. */
  titles: Record<string, string>;
}) {
  if (summary.totals.views === 0) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        No visits counted yet. Every page a visitor opens on the published site counts here.
      </p>
    );
  }
  const max = Math.max(1, ...summary.days.map((d) => d.visitors));
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <div className="space-y-5 p-5">
      <p className="text-sm">
        <span className="font-medium">{n(summary.totals.visitors)}</span>{" "}
        {summary.totals.visitors === 1 ? "visitor" : "visitors"} and{" "}
        <span className="font-medium">{n(summary.totals.views)}</span>{" "}
        {summary.totals.views === 1 ? "page view" : "page views"} in the last {summary.days.length} days.
      </p>
      <div>
        <div className="flex h-24 items-end gap-0.5" role="img" aria-label="Visitors per day">
          {summary.days.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${n(d.visitors)} ${d.visitors === 1 ? "visitor" : "visitors"}, ${n(d.views)} ${d.views === 1 ? "view" : "views"}`}
              className="flex-1 rounded-t bg-primary/70"
              style={{ height: `${Math.max(2, Math.round((d.visitors / max) * 100))}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{summary.days[0]?.day}</span>
          <span>{summary.days[summary.days.length - 1]?.day}</span>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 font-medium">Page</th>
            <th className="pb-2 text-right font-medium">Views</th>
            <th className="pb-2 text-right font-medium">Visitors</th>
          </tr>
        </thead>
        <tbody>
          {summary.pages.map((p) => (
            <tr key={p.path} className="border-t border-divider">
              <td className="py-2">
                {titles[p.path] ?? p.path}
                <span className="ml-2 font-mono text-xs text-muted-foreground">{p.path}</span>
              </td>
              <td className="py-2 text-right tabular-nums">{n(p.views)}</td>
              <td className="py-2 text-right tabular-nums">{n(p.visitors)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        A visitor is a browser on its first page of the day; a view is every page it opens. Nothing about the person is kept.
      </p>
    </div>
  );
}

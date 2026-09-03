import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveDocLink } from "@/lib/markdown-meta";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  source: string;
  className?: string;
  /**
   * Where relative `.md` links resolve to: `root` is the URL the tree is
   * served under, `slug` is the doc being rendered (a link is relative to its
   * folder). Without it a relative link is left as written.
   */
  linkBase?: { root: string; slug: string };
}

/**
 * The one markdown renderer for prose that arrives as text — a build doc, a
 * guide.
 *
 * `prose-sm` + `dark:prose-invert` were hand-copied at seven call sites before
 * this existed; the admin doc page and the guides use this, the other five
 * are an open item. No `rehype-raw`, on purpose: raw HTML in a doc is never
 * rendered, and HTML comments are stripped by the readers before the text
 * gets here.
 *
 * Links: a relative `.md` link becomes a client-side navigation to the doc it
 * names — `[Getting around](../workspace/getting-around.md)` — which the
 * admin page had been rendering as a request for a file that 404s. An
 * absolute app path navigates; anything with a scheme opens in a new tab.
 *
 * No directive: it renders on the server for the pages and is loaded lazily
 * by the client-side help panel, so it must import nothing from `node:`.
 */
export function Markdown({ source, className, linkBase }: MarkdownProps) {
  const components: Components = {
    a: ({ href, children }) => {
      const url = href ?? "";
      const doc = linkBase ? resolveDocLink(linkBase.slug, url) : null;
      if (linkBase && doc) {
        return <Link href={`${linkBase.root}/${doc}`}>{children}</Link>;
      }
      if (url.startsWith("/")) return <Link href={url}>{children}</Link>;
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
        return (
          <a href={url} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
      return <a href={url}>{children}</a>;
    },
  };

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none [&_table]:text-sm",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

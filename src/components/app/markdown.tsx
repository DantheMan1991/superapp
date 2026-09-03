import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveDocLink } from "@/lib/markdown-meta";
import { remarkGuideControls } from "@/lib/remark-guide-controls";
import { cn } from "@/lib/utils";
import { GuideControl } from "./guide-control";

interface MarkdownProps {
  source: string;
  className?: string;
  /**
   * Where relative `.md` links resolve to: `root` is the URL the tree is
   * served under, `slug` is the doc being rendered (a link is relative to its
   * folder). Without it a relative link is left as written.
   */
  linkBase?: { root: string; slug: string };
  /**
   * `guide` is prose a client reads: inline code is a label chip in the app's
   * own face (see `.guide-prose` in globals.css), and `{button:…}` markers draw
   * the real controls. `doc`, the default, is the build record, where inline
   * code is code.
   */
  flavor?: "doc" | "guide";
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
export function Markdown({ source, className, linkBase, flavor = "doc" }: MarkdownProps) {
  const guide = flavor === "guide";
  const components: Components = {
    // A custom element name is outside the `Components` type, which is keyed
    // by HTML tag; the renderer looks components up by tag name at runtime.
    ...(guide ? ({ "guide-control": GuideControl } as unknown as Components) : {}),
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
        guide && "guide-prose",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={guide ? [remarkGfm, remarkGuideControls] : [remarkGfm]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

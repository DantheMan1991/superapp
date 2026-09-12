"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, Check, ImageIcon, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/app/empty-state";
import { Panel } from "@/components/app/panel";
import { channelTitle } from "@/lib/social/channels";
import {
  dayHeading,
  groupByDay,
  postDay,
  POST_STATUS_LABELS,
  postTitle,
  type PostStatus,
} from "@/lib/social/posts";
import type { SocialNetwork } from "@/lib/sites/links";
import { addPostAction, type PostView } from "../post-actions";

/**
 * The calendar, which on a phone is a list (slice S1).
 *
 * A MONTH GRID WAS NOT BUILT, and that is a decision rather than a shortcut: a
 * business posts a handful of times a week, so a grid would be four rows of
 * empty boxes around three entries, and it reads badly at 375px where this is
 * most used. Grouped by day, newest work first, it says the same thing in the
 * space it needs.
 */
export interface PostsPanelProps {
  posts: PostView[];
  /** The accounts a new post can be written against — active ones only. */
  channels: { id: string; network: string; handle: string; label: string }[];
  /**
   * Where "Add an account" goes, with this brand and `add=1` on it — so the
   * button opens the form rather than landing on a screen with the SAME BUTTON
   * on it, which is what it did when S1 shipped.
   */
  accountsHref: string;
  /** The tenant's today, `YYYY-MM-DD`, so "Today" means their today. */
  today: string;
  timezone: string;
  canWrite: boolean;
}

export function PostsPanel({ posts, channels, accountsHref, today, timezone, canWrite }: PostsPanelProps) {
  const router = useRouter();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  const groups = groupByDay(posts, (p) => postDay(p.scheduledAt ? new Date(p.scheduledAt) : null, timezone));

  function write() {
    if (!channelId) return;
    startTransition(async () => {
      const result = await addPostAction({ channelId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Straight into the words — a new post with nothing in it is not
      // something to admire in a list.
      router.push(`/dashboard/m/marketing/social/posts/${result.data?.id}`);
    });
  }

  return (
    <div className="space-y-4">
      {canWrite && channels.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {channels.length > 1 && (
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger className="h-9 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {channelTitle({
                      network: c.network as SocialNetwork,
                      handle: c.handle,
                      label: c.label,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button disabled={pending || !channelId} onClick={write}>
            <Plus className="size-4" /> Write a post
          </Button>
          {channels.length === 1 && (
            <span className="text-sm text-muted-foreground">
              for{" "}
              {channelTitle({
                network: channels[0].network as SocialNetwork,
                handle: channels[0].handle,
                label: channels[0].label,
              })}
            </span>
          )}
        </div>
      )}

      {posts.length === 0 ? (
        <Panel
          isEmpty
          empty={
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title="Nothing written yet"
              description={
                channels.length === 0
                  ? "Add an account first, then posts you write here can be aimed at it."
                  : "Write a post, put a photo on it, and put it on the calendar. Yosher reminds you when it is time to post it."
              }
              action={
                channels.length === 0 ? (
                  <Button asChild variant="outline">
                    <Link href={accountsHref}>Add an account</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {null}
        </Panel>
      ) : (
        groups.map((group) => (
          <section key={group.day ?? "none"} className="space-y-2">
            <h2 className="font-heading text-sm font-semibold tracking-heading text-muted-foreground">
              {dayHeading(group.day, today)}
            </h2>
            <Panel>
              <ul className="divide-y divide-divider">
                {group.items.map((post) => (
                  <li key={post.id}>
                    {/* The row is the link (design-system.md, 2026-09-06). */}
                    <Link
                      href={`/dashboard/m/marketing/social/posts/${post.id}`}
                      className="flex items-start justify-between gap-4 px-4 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="min-w-0 space-y-1">
                        <span className="block truncate font-medium">
                          {postTitle({ body: post.body, network: post.network as SocialNetwork })}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
                          <span>
                            {channelTitle({
                              network: post.network as SocialNetwork,
                              handle: post.handle,
                              label: post.label,
                            })}
                          </span>
                          {post.scheduledAt && (
                            <span>
                              {new Intl.DateTimeFormat("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                                timeZone: timezone,
                              }).format(new Date(post.scheduledAt))}
                            </span>
                          )}
                          {post.imageId && (
                            <span className="inline-flex items-center gap-1">
                              <ImageIcon className="size-3" /> Photo
                            </span>
                          )}
                        </span>
                      </span>
                      <StatusBadge status={post.status as PostStatus} reminded={post.remindedAt !== null} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </section>
        ))
      )}
    </div>
  );
}

function StatusBadge({ status, reminded }: { status: PostStatus; reminded: boolean }) {
  if (status === "posted") {
    return (
      <Badge variant="secondary" className="shrink-0">
        <Check className="size-3" /> {POST_STATUS_LABELS.posted}
      </Badge>
    );
  }
  if (status === "scheduled") {
    return (
      <Badge variant={reminded ? "default" : "outline"} className="shrink-0">
        {reminded ? (
          <>
            <Send className="size-3" /> Time to post
          </>
        ) : (
          POST_STATUS_LABELS.scheduled
        )}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0">
      {POST_STATUS_LABELS.draft}
    </Badge>
  );
}

import "server-only";
import type { ProgramInput } from "./core/program";

/**
 * WHAT YOUTUBE SAYS ABOUT A VIDEO, asked once: will it play here, and what is
 * it called.
 *
 * An uploader can switch embedding off, and a video can be taken down. Either
 * way an embedded player would load and show an error. So when a program is
 * drafted, and when one is saved with a video nobody has asked about yet, the
 * oEmbed endpoint is asked: 200 means it plays here; 401/403 (embedding off)
 * and 404 (gone) mean it does not, and the exercise shows "Open in YouTube"
 * instead. Anything else — a timeout, a 5xx — leaves it unknown (`null`),
 * which plays the embed and lets YouTube say so, rather than hiding a video
 * that may well work.
 *
 * **The title names a second video.** An exercise's first video is THE video;
 * any other needs a label, and the book rarely gives one. The founder's
 * release sequence links five videos — five different rolls — and a draft that
 * called four of them "Alternative" (as the first cut of this did) would have
 * told him the wrong thing mid-session. So an unlabelled second video takes
 * YouTube's own title: "Inner Foot Roll", "Outer Foot Roll".
 *
 * Checked 2026-09-27 against the founder's program: 28 of its 29 videos
 * answer 200; the 29th is gone, and is linked only from an overview page.
 */

export interface VideoFacts {
  embeddable: boolean | null;
  title: string | null;
}

export type VideoCheck = (videoId: string) => Promise<VideoFacts>;

export const checkVideo: VideoCheck = async (videoId) => {
  const watch = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`,
      { cache: "no-store", signal: AbortSignal.timeout(5_000) },
    );
    if (response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const title =
        body && typeof body === "object" && typeof (body as { title?: unknown }).title === "string"
          ? ((body as { title: string }).title.replace(/\s+/g, " ").trim() || null)
          : null;
      return { embeddable: true, title };
    }
    if ([401, 403, 404].includes(response.status)) return { embeddable: false, title: null };
    return { embeddable: null, title: null };
  } catch {
    return { embeddable: null, title: null };
  }
};

/** At most this many questions to YouTube at once. */
const AT_ONCE = 6;

/**
 * Fill in what is missing on every video: whether it plays here, and — for an
 * exercise's second video onwards — a label. Each distinct video is asked
 * about once, however many exercises share it; one already answered and
 * already labelled is not asked about again, so an edit asks only about what
 * it added. The exercise's first video never gets a label: it is the video.
 */
export async function markVideos(
  program: ProgramInput,
  check: VideoCheck = checkVideo,
): Promise<ProgramInput> {
  const ask = new Set<string>();
  for (const phase of program.phases) {
    for (const item of phase.items) {
      item.videos.forEach((video, v) => {
        if (video.embeddable === null || (v > 0 && video.label === null)) ask.add(video.id);
      });
    }
  }
  const answers = new Map<string, VideoFacts>();
  const queue = [...ask];
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, queue.length) }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        answers.set(id, await check(id));
      }
    }),
  );
  return {
    ...program,
    phases: program.phases.map((phase) => ({
      ...phase,
      items: phase.items.map((item) => ({
        ...item,
        videos: item.videos.map((video, v) => {
          const facts = answers.get(video.id);
          if (!facts) return video;
          return {
            ...video,
            embeddable: video.embeddable ?? facts.embeddable,
            label:
              v > 0 && video.label === null && facts.title
                ? facts.title.slice(0, 60).trim()
                : video.label,
          };
        }),
      })),
    })),
  };
}

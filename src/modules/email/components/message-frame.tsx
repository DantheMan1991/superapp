"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MESSAGE_FRAME_SANDBOX } from "../render/policy";

/**
 * The message body, in an iframe.
 *
 * This component exists for ONE reason: to read the framed document's height
 * and grow the frame to fit, so the reading pane has a single scrollbar instead
 * of one nested inside another. That is the entire justification for
 * `allow-same-origin` being in the sandbox list.
 *
 * THE RULE, and it is not negotiable: the parent may read `scrollHeight` and
 * nothing else. Never `innerHTML`, never `textContent`, never copy a node out.
 * The frame contains markup written by an anonymous sender; the only safe thing
 * to take from it is a number.
 */

const MIN_HEIGHT = 80;
/** Past this, something is wrong with the message and the pane scrolls instead. */
const MAX_HEIGHT = 20_000;
const FALLBACK_HEIGHT = 600;

export function MessageFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(FALLBACK_HEIGHT);

  const measure = useCallback(() => {
    const frame = ref.current;
    // contentDocument is null if the frame ever becomes cross-origin — which it
    // should not here, but the fallback height plus a scrollbar is a working
    // reading pane, so there is nothing to do but leave it alone.
    const doc = frame?.contentDocument;
    if (!doc?.documentElement) return;

    // MEASURE THE BODY, NOT THE ROOT.
    //
    // `documentElement.scrollHeight` is circular here: the root element fills
    // the frame, so it reports the height the frame ALREADY has. Observed
    // directly — a 278px message inside a 600px frame reported 600 from the
    // root and 278 from the body. Taking the larger of the two would pin every
    // short message at whatever height it happened to start with.
    //
    // The body reports actual content in both directions, so a message can
    // shrink the frame as well as grow it. `body { margin: 0 }` in the frame's
    // own reset is what makes scrollHeight trustworthy.
    const body = doc.body;
    if (!body) return;
    const next = Math.max(
      body.scrollHeight,
      Math.ceil(body.getBoundingClientRect().height),
    );
    if (!Number.isFinite(next) || next <= 0) return;
    setHeight(Math.min(Math.max(next, MIN_HEIGHT), MAX_HEIGHT));
  }, []);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;

    // Remote content and fonts can settle after load, so one measurement is not
    // enough — observe the document and re-measure as it reflows.
    let observer: ResizeObserver | null = null;
    const attach = () => {
      measure();
      const doc = frame.contentDocument;
      if (doc?.documentElement && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => measure());
        observer.observe(doc.documentElement);
      }
    };

    frame.addEventListener("load", attach);
    // Already loaded from cache by the time the effect runs.
    if (frame.contentDocument?.readyState === "complete") attach();
    window.addEventListener("resize", measure);

    return () => {
      frame.removeEventListener("load", attach);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure, src]);

  return (
    <iframe
      ref={ref}
      // Keyed on src so switching message tears the frame down rather than
      // reusing a document from the previous one.
      key={src}
      src={src}
      title={title}
      sandbox={MESSAGE_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      className="w-full border-0 bg-transparent"
      // `auto`, never `hidden`. Sized to its content there is nothing to
      // scroll — but if a measurement ever comes up short, an inner scrollbar
      // is an annoyance where hidden overflow is the end of a message quietly
      // missing. Only one of those is recoverable by the reader.
      style={{ height, overflow: "auto" }}
    />
  );
}

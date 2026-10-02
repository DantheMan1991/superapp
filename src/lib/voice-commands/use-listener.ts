import { useSyncExternalStore } from "react";
import { listenerState, listenerStateOnTheServer, subscribeListener, type ListenerState } from "./listener";

/** The page's listener, as the screen shows it: off, starting, listening, held, paused or failed. */
export function useListener(): ListenerState {
  return useSyncExternalStore(subscribeListener, listenerState, listenerStateOnTheServer);
}

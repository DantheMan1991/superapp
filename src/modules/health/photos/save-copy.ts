import { readNativeBridge } from "@/lib/native-bridge";
import { appCanSaveFiles, nativeAppInfo } from "@/lib/native-app-core";

/**
 * "SAVE A COPY" (H2b; the founder's call, 2026-10-03: a copy leaves Health's
 * own storage only when he taps for one, photo by photo). The one way a
 * picture leaves the page's keeping, and only onto this phone:
 *
 * - **In the app (1.0.9 and later)**: the shell writes it into the phone's
 *   Documents, under `Yosher`, where the Files app finds it
 *   (`@capacitor/filesystem`). A WebView ignores a download link.
 * - **In an older app**: nothing is saved, and the person is told to update.
 * - **In a browser**: an ordinary download, into the phone's Downloads.
 *
 * It sends nothing to any server: the bytes go from this page to this phone's
 * own files. What happens to the copy after that (a gallery's backup) is the
 * phone's, which is why it is the person's tap and not a default.
 */

export type SavedTo = "documents" | "downloads" | "update-app";

export async function saveCopy(blob: Blob, name: string): Promise<SavedTo> {
  const app = nativeAppInfo(navigator.userAgent);
  if (app) {
    const files = readNativeBridge(window)?.files ?? null;
    if (!files || !appCanSaveFiles(app)) return "update-app";
    await files.writeFile({ path: `Yosher/${name}`, data: await base64Of(blob), directory: "DOCUMENTS", recursive: true });
    return "documents";
  }
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Long enough for the download to start; the address dies with it.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return "downloads";
}

/** The bytes as base64, for the shell. */
async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(text);
}

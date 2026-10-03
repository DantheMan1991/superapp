import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import app from "../mobile/app.json";
import {
  APP_CAMERA_VERSION,
  APP_FILES_VERSION,
  compareVersions,
  isNativeAppUserAgent,
  nativeAppInfo,
  NATIVE_APP_UA_MARKER,
} from "@/lib/native-app-core";

/**
 * The shell and the web are two packages that must agree on one string: the
 * user-agent marker. If the shell sent a marker the web did not read, the
 * app would show purchase buttons and a sign-up form to a store reviewer.
 * The shell's config is read as text rather than imported, so the web's
 * type-check never depends on the shell's own dependencies being installed.
 */
const shell = (file: string) => path.join(process.cwd(), "mobile", file);

describe("the shell and the web agree", () => {
  it("the shell's user-agent marker is the one the web reads", () => {
    expect(`${app.userAgentMarker}/`).toBe(NATIVE_APP_UA_MARKER);
    for (const platform of ["ios", "android"] as const) {
      const ua = `Mozilla/5.0 (Mobile) ${app.userAgentMarker}/${app.version} (${platform})`;
      expect(isNativeAppUserAgent(ua)).toBe(true);
      expect(nativeAppInfo(ua)).toEqual({ version: app.version, platform });
    }
  });

  it("loads the production site and bundles an offline page", () => {
    expect(app.url).toBe("https://yosherapp.com");
    expect(app.startPath).toBe("/dashboard");
    expect(readFileSync(shell("capacitor.config.ts"), "utf8")).toContain("app.startPath");
    const config = readFileSync(shell("capacitor.config.ts"), "utf8");
    expect(config).toContain('errorPath: "offline.html"');
    expect(config).toContain("appendUserAgent");
    expect(existsSync(shell(path.join("www", "offline.html")))).toBe(true);
  });

  it("is registered with Firebase for push, under its own package name", () => {
    const services = JSON.parse(
      readFileSync(shell(path.join("android", "app", "google-services.json")), "utf8"),
    ) as { client?: Array<{ client_info?: { android_client_info?: { package_name?: string } } }> };
    const packages = (services.client ?? []).map(
      (c) => c.client_info?.android_client_info?.package_name,
    );
    expect(packages).toContain(app.appId);
  });

  /**
   * THE BUG THIS GUARDS SHIPPED, and its symptom was unfollowable advice.
   *
   * The site records a sentence through `getUserMedia` inside the WebView.
   * Capacitor's `BridgeWebChromeClient` catches that and asks Android for
   * RECORD_AUDIO at runtime — but **a runtime request for a permission the
   * manifest never declared is denied instantly, with no dialog**, and an app
   * is listed in Android's permission settings only for what it declared. So
   * the app said "allow the microphone" and there was no switch anywhere to
   * do it with. The founder found it on his own phone.
   *
   * Asserted here rather than trusted, because the manifest is edited by hand
   * and nothing else in this repo would ever mention these two strings again.
   */
  it("declares the microphone, so Android can actually be asked for it", () => {
    const manifest = readFileSync(
      shell(path.join("android", "app", "src", "main", "AndroidManifest.xml")),
      "utf8",
    );
    expect(manifest).toContain("android.permission.RECORD_AUDIO");
    // Capacitor asks for BOTH together and denies the WebView unless both are
    // granted, so declaring only the obvious one still fails.
    expect(manifest).toContain("android.permission.MODIFY_AUDIO_SETTINGS");
    // Never REQUIRED: dictation is a convenience and the app works by typing
    // on any device, so the Play listing must not be filtered by it.
    expect(manifest).toMatch(
      /android\.hardware\.microphone"\s+android:required="false"/,
    );
  });

  it("keeps one version in one place", () => {
    const pkg = JSON.parse(readFileSync(shell("package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe(app.version);
    // The native numbers too: a build whose versionName lags app.json would
    // report one version to the web and another to Android.
    const gradle = readFileSync(shell(path.join("android", "app", "build.gradle")), "utf8");
    expect(gradle).toContain(`versionName "${app.version}"`);
  });

  /**
   * THE CAMERA, for the posture check (docs/modules/posture.md; ADR 0118).
   * The same trap as the microphone above, so the same guard: Capacitor asks
   * Android for CAMERA when the WebView wants video, and an undeclared
   * permission is refused without a dialog. And the web tells an app older
   * than APP_CAMERA_VERSION to update rather than allow, so the build that
   * declares the camera must report a version the web counts as able.
   */
  it("declares the camera, and reports a version the web knows can use it", () => {
    const manifest = readFileSync(
      shell(path.join("android", "app", "src", "main", "AndroidManifest.xml")),
      "utf8",
    );
    expect(manifest).toContain("android.permission.CAMERA");
    // Never REQUIRED: the posture check is one screen, and the Play listing
    // must not be filtered off a device without a camera.
    expect(manifest).toMatch(/android\.hardware\.camera"\s+android:required="false"/);
    // Workout mode's buzz: navigator.vibrate is silent in a WebView without it.
    expect(manifest).toContain("android.permission.VIBRATE");
    expect(compareVersions(app.version, APP_CAMERA_VERSION)).toBeGreaterThanOrEqual(0);
  });

  it("carries the privacy screen and keep-awake plugins, wired into the Android build", () => {
    const pkg = JSON.parse(readFileSync(shell("package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@capacitor/privacy-screen"]).toBeTruthy();
    expect(pkg.dependencies["@capacitor-community/keep-awake"]).toBeTruthy();
    // `cap sync` writes these; a plugin missing from them is not in the APK.
    const settings = readFileSync(shell(path.join("android", "capacitor.settings.gradle")), "utf8");
    expect(settings).toContain(":capacitor-privacy-screen");
    expect(settings).toContain(":capacitor-community-keep-awake");
    const build = readFileSync(shell(path.join("android", "app", "capacitor.build.gradle")), "utf8");
    expect(build).toContain("project(':capacitor-privacy-screen')");
    expect(build).toContain("project(':capacitor-community-keep-awake')");
  });

  /**
   * "SAVE A COPY" of a progress photo (docs/modules/health.md, H2b; ADR 0128):
   * a WebView ignores a download, so the shell writes the file, and the web
   * tells an app older than APP_FILES_VERSION to update. Writing into
   * Documents needs a permission only up to Android 10, never past it.
   */
  it("carries the file plugin, wired in, the storage permission held to Android 10, and a version the web knows can save", () => {
    const pkg = JSON.parse(readFileSync(shell("package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@capacitor/filesystem"]).toBeTruthy();
    const settings = readFileSync(shell(path.join("android", "capacitor.settings.gradle")), "utf8");
    expect(settings).toContain(":capacitor-filesystem");
    const build = readFileSync(shell(path.join("android", "app", "capacitor.build.gradle")), "utf8");
    expect(build).toContain("project(':capacitor-filesystem')");
    const manifest = readFileSync(
      shell(path.join("android", "app", "src", "main", "AndroidManifest.xml")),
      "utf8",
    );
    expect(manifest).toMatch(/android\.permission\.WRITE_EXTERNAL_STORAGE"\s+android:maxSdkVersion="29"/);
    expect(manifest).toContain('android:requestLegacyExternalStorage="true"');
    expect(compareVersions(app.version, APP_FILES_VERSION)).toBeGreaterThanOrEqual(0);
  });
});

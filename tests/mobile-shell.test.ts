import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import app from "../mobile/app.json";
import {
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

  it("keeps one version in one place", () => {
    const pkg = JSON.parse(readFileSync(shell("package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe(app.version);
  });
});

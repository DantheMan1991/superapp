import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

/**
 * A manifest that names an icon that is not there, or at a size it is not,
 * installs nothing and says nothing. Checked against the files in public/.
 */
describe("install manifest", () => {
  it("is a standalone app whose icons exist at the sizes it declares", async () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/dashboard");
    const icons = m.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of icons) {
      const file = path.join(process.cwd(), "public", icon.src);
      expect(existsSync(file), `${icon.src} exists`).toBe(true);
      const meta = await sharp(file).metadata();
      expect(`${meta.width}x${meta.height}`, icon.src).toBe(icon.sizes);
    }
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });
});

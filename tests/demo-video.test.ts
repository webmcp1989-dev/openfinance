import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const rendererRoot = join(repositoryRoot, "scripts", "demo-video");
const manifest = JSON.parse(readFileSync(join(rendererRoot, "manifest.json"), "utf8")) as {
  slides: Array<{
    audio: string;
    image?: string;
    narration: string;
  }>;
};

describe("challenge demo video source", () => {
  test("keeps a compact, complete, uniquely narrated story", () => {
    expect(manifest.slides).toHaveLength(8);
    expect(new Set(manifest.slides.map((slide) => slide.audio)).size).toBe(8);
    expect(manifest.slides.every((slide) => /^narration-\d{2}\.wav$/.test(slide.audio))).toBe(true);

    const wordCount = manifest.slides
      .flatMap((slide) => slide.narration.trim().split(/\s+/))
      .length;
    expect(wordCount).toBeGreaterThanOrEqual(250);
    expect(wordCount).toBeLessThanOrEqual(400);
  });

  test("ships only bounded synthetic deployed-app screenshots", () => {
    const images = manifest.slides.flatMap((slide) => slide.image ? [slide.image] : []);
    expect(images).toEqual(["ar-start.png", "ap-start.png"]);

    for (const image of images) {
      const path = join(rendererRoot, "assets", image);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(50_000);
      expect(statSync(path).size).toBeLessThan(500_000);
    }
  });

  test("renders a 16:9 VP9 and Opus artifact with bounded local upload", () => {
    const page = readFileSync(join(rendererRoot, "index.html"), "utf8");
    const renderer = readFileSync(join(rendererRoot, "renderer.js"), "utf8");
    const server = readFileSync(join(rendererRoot, "server.ts"), "utf8");
    expect(page).toContain('canvas width="1600" height="900"');
    expect(renderer).toContain("video/webm;codecs=vp9,opus");
    expect(renderer).toContain("videoBitsPerSecond: 2_500_000");
    expect(server).toContain('url.pathname === "/artifact"');
    expect(server).toContain('url.pathname === "/thumbnail"');
    expect(server).toContain("bytes.byteLength > 500_000_000");
    expect(server).toContain("bytes.byteLength > 2_000_000");
    expect(server).toContain('"content-range"');
  });

  test("includes a public-safe YouTube publication package", () => {
    const publication = readFileSync(join(repositoryRoot, "docs", "YOUTUBE.md"), "utf8");
    expect(publication).toContain("OpenFinance: Human-Controlled AR-to-AP Interoperability with WebMCP");
    expect(publication).toContain("https://openfinance-ar.vercel.app");
    expect(publication).toContain("https://openfinance-ap.vercel.app");
    expect(publication).toContain("https://github.com/webmcp1989-dev/openfinance");
    expect(publication).toContain("Visibility: **Public**");
    expect(publication).toContain("Do not place judge passwords");
    expect(publication).not.toMatch(/Of(?:AR|AP)!/);
  });

  test("ships a bounded 16:9 YouTube thumbnail", () => {
    const thumbnail = join(rendererRoot, "assets", "youtube-thumbnail.png");
    expect(existsSync(thumbnail)).toBe(true);
    const bytes = readFileSync(thumbnail);
    expect(bytes.readUInt32BE(16)).toBe(1600);
    expect(bytes.readUInt32BE(20)).toBe(900);
    expect(statSync(thumbnail).size).toBeGreaterThan(10_000);
    expect(statSync(thumbnail).size).toBeLessThan(2_000_000);
  });
});

import { join, normalize } from "node:path";

const repositoryRoot = normalize(join(import.meta.dir, "..", ".."));
const artifactDirectory = join(repositoryRoot, "artifacts", "demo-video");
const rendererDirectory = import.meta.dir;
const outputPath = join(artifactDirectory, "openfinance-demo.webm");
const thumbnailPath = join(rendererDirectory, "assets", "youtube-thumbnail.png");

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot);
}

function safeAssetPath(name: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name)) return null;
  const directory = extension(name) === ".png"
    ? join(rendererDirectory, "assets")
    : artifactDirectory;
  return join(directory, name);
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4178,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/artifact") {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.startsWith("video/webm")) {
        return new Response("Expected video/webm", { status: 415 });
      }

      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength < 100_000 || bytes.byteLength > 500_000_000) {
        return new Response("Unexpected artifact size", { status: 422 });
      }

      await Bun.write(outputPath, bytes);
      return Response.json({ bytes: bytes.byteLength, outputPath });
    }

    if (request.method === "POST" && url.pathname === "/thumbnail") {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/png")) {
        return new Response("Expected image/png", { status: 415 });
      }

      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength < 10_000 || bytes.byteLength > 2_000_000) {
        return new Response("Unexpected thumbnail size", { status: 422 });
      }

      await Bun.write(thumbnailPath, bytes);
      return Response.json({ bytes: bytes.byteLength, thumbnailPath });
    }

    let filePath: string | null = null;
    if (url.pathname === "/" || url.pathname === "/index.html") {
      filePath = join(rendererDirectory, "index.html");
    } else if (url.pathname === "/renderer.js") {
      filePath = join(rendererDirectory, "renderer.js");
    } else if (url.pathname === "/manifest.json") {
      filePath = join(rendererDirectory, "manifest.json");
    } else if (url.pathname.startsWith("/assets/")) {
      filePath = safeAssetPath(url.pathname.slice("/assets/".length));
    }

    if (!filePath) return new Response("Not found", { status: 404 });
    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    const range = request.headers.get("range");
    if (range && extension(filePath) === ".webm") {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return new Response("Invalid range", { status: 416 });
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : file.size - 1;
      const end = Math.min(requestedEnd, file.size - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size) {
        return new Response("Range not satisfiable", {
          status: 416,
          headers: { "content-range": `bytes */${file.size}` },
        });
      }

      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "cache-control": "no-store",
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/${file.size}`,
          "content-type": "video/webm",
        },
      });
    }

    return new Response(file, {
      headers: {
        "accept-ranges": extension(filePath) === ".webm" ? "bytes" : "none",
        "cache-control": "no-store",
        "content-type": contentTypes[extension(filePath)] ?? "application/octet-stream",
      },
    });
  },
});

console.log(`Demo renderer: ${server.url}`);
console.log(`Output: ${outputPath}`);

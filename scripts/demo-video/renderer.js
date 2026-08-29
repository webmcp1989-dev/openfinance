const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d", { alpha: false });
const button = document.querySelector("button");
const output = document.querySelector("output");
const preview = document.querySelector("video");
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const GAP_SECONDS = 0.45;

const manifest = await fetch("/manifest.json", { cache: "no-store" }).then((response) => {
  if (!response.ok) throw new Error("Unable to load the demo manifest.");
  return response.json();
});

const audioContext = new AudioContext({ sampleRate: 48_000 });

async function loadAudio(name) {
  const response = await fetch(`/assets/${name}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${name}.`);
  return audioContext.decodeAudioData(await response.arrayBuffer());
}

async function loadImage(name) {
  if (!name) return null;
  const response = await fetch(`/assets/${name}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${name}.`);
  return createImageBitmap(await response.blob());
}

function roundedRect(x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function fillTextWrapped(text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
}

function drawBackground(image) {
  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#07110f");
  gradient.addColorStop(0.55, "#0c1f19");
  gradient.addColorStop(1, "#17392e");
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  if (image) {
    const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.save();
    context.globalAlpha = 0.56;
    context.filter = "blur(1.4px) saturate(.7)";
    context.drawImage(image, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
    context.restore();
    const shade = context.createLinearGradient(0, 0, WIDTH, 0);
    shade.addColorStop(0, "rgba(5, 16, 13, .96)");
    shade.addColorStop(0.58, "rgba(5, 16, 13, .76)");
    shade.addColorStop(1, "rgba(5, 16, 13, .38)");
    context.fillStyle = shade;
    context.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

function drawSlide(slide, image, progress) {
  drawBackground(image);
  const ease = 1 - Math.pow(1 - Math.min(progress * 3.5, 1), 3);
  const offset = 26 * (1 - ease);
  context.save();
  context.globalAlpha = 0.35 + 0.65 * ease;
  context.translate(0, offset);

  context.fillStyle = "#89f5c4";
  context.font = "700 24px Inter, system-ui, sans-serif";
  context.fillText(slide.eyebrow, 110, 145);

  context.fillStyle = "#f2fff9";
  context.font = slide.kind === "title" ? "800 88px Inter, system-ui, sans-serif" : "800 64px Inter, system-ui, sans-serif";
  fillTextWrapped(slide.title, 110, 255, 1040, slide.kind === "title" ? 100 : 76, 3);

  if (slide.subtitle) {
    context.fillStyle = "#c9e4da";
    context.font = "430 34px Inter, system-ui, sans-serif";
    fillTextWrapped(slide.subtitle, 110, slide.kind === "title" ? 400 : 385, 1050, 46, 3);
  }

  if (slide.bullets?.length) {
    const startY = slide.subtitle ? 530 : 430;
    slide.bullets.forEach((bullet, index) => {
      const y = startY + index * 74;
      context.fillStyle = "#89f5c4";
      context.beginPath();
      context.arc(128, y - 9, 7, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#e6f8f1";
      context.font = "500 30px Inter, system-ui, sans-serif";
      context.fillText(bullet, 158, y);
    });
  }

  context.fillStyle = "rgba(137, 245, 196, .18)";
  roundedRect(110, 790, 1380, 5, 3);
  context.fill();
  context.fillStyle = "#89f5c4";
  roundedRect(110, 790, Math.max(8, 1380 * progress), 5, 3);
  context.fill();
  context.fillStyle = "#9ebdb2";
  context.font = "600 22px Inter, system-ui, sans-serif";
  context.fillText("OPENFINANCE  ·  HUMAN + AGENT + WEBMCP", 110, 848);
  context.restore();
}

function supportedMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

async function render() {
  button.disabled = true;
  output.textContent = "Loading narration and deployed-app frames…";
  await audioContext.resume();

  const audioBuffers = await Promise.all(manifest.slides.map((slide) => loadAudio(slide.audio)));
  const images = await Promise.all(manifest.slides.map((slide) => loadImage(slide.image)));
  const timeline = [];
  let cursor = 0;
  audioBuffers.forEach((buffer, index) => {
    timeline.push({ start: cursor, end: cursor + buffer.duration, index });
    cursor += buffer.duration + GAP_SECONDS;
  });
  const totalDuration = cursor - GAP_SECONDS;

  const audioDestination = audioContext.createMediaStreamDestination();
  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(combinedStream, { mimeType: supportedMimeType(), videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 160_000 });
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });

  const startedAt = audioContext.currentTime + 0.25;
  audioBuffers.forEach((buffer, index) => {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioDestination);
    source.start(startedAt + timeline[index].start);
  });

  recorder.start(1000);
  output.textContent = `Rendering ${Math.ceil(totalDuration)} seconds…`;

  await new Promise((resolve) => {
    function frame() {
      const elapsed = Math.max(0, audioContext.currentTime - startedAt);
      const active = timeline.find((entry) => elapsed >= entry.start && elapsed < entry.end + GAP_SECONDS) ?? timeline.at(-1);
      const duration = active.end - active.start;
      const progress = Math.min(1, Math.max(0, (elapsed - active.start) / duration));
      drawSlide(manifest.slides[active.index], images[active.index], progress);
      if (elapsed < totalDuration + 0.4) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });

  recorder.stop();
  await new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  const video = new Blob(chunks, { type: "video/webm" });
  const response = await fetch("/artifact", { method: "POST", headers: { "content-type": "video/webm" }, body: video });
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json();
  output.textContent = `Saved ${Math.round(result.bytes / 1024 / 1024)} MB · ${Math.round(totalDuration)} seconds`;
  preview.load();
  button.disabled = false;
}

drawSlide(manifest.slides[0], null, 0.01);
document.querySelectorAll("button[data-seek]").forEach((seekButton) => {
  seekButton.addEventListener("click", () => {
    preview.currentTime = Number(seekButton.dataset.seek);
    preview.pause();
  });
});
button.addEventListener("click", () => render().catch((error) => {
  console.error(error);
  output.textContent = `Render failed: ${error.message}`;
  button.disabled = false;
}));

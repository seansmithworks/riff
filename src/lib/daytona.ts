// Daytona handoff — spins up a live sandbox that serves a minimal static
// HTML page rendered from an Artifact, and returns its public preview URL.

import { Daytona } from "@daytona/sdk";
import type { Artifact, Screen, Element } from "./artifact";
import type { Message } from "./store";

const PREVIEW_PORT = 8080;
const APP_DIR = "/home/daytona/app";

export interface HandoffResult {
  url: string;
  sandboxId: string;
}

export async function createHandoffPreview(
  artifact: Artifact,
  messages?: Message[],
): Promise<HandoffResult> {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is not set");
  }

  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.create({ public: true });

  const html = renderHandoffHtml(artifact, messages ?? []);
  await sandbox.fs.uploadFile(Buffer.from(html), `${APP_DIR}/index.html`);

  const sessionId = `handoff-${Date.now()}`;
  await sandbox.process.createSession(sessionId);
  await sandbox.process.executeSessionCommand(sessionId, {
    command: `cd ${APP_DIR} && python3 -m http.server ${PREVIEW_PORT}`,
    runAsync: true,
  });

  // Give the server a moment to bind before requesting the preview link.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const preview = await sandbox.getPreviewLink(PREVIEW_PORT);
  return { url: preview.url, sandboxId: sandbox.id };
}

// --- Minimal HTML rendering -------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderElement(el: Element): string {
  switch (el.type) {
    case "navbar":
      return `<div class="el navbar"><strong>${escapeHtml(el.title)}</strong>${
        el.actions?.length
          ? ` <span class="muted">${el.actions.map(escapeHtml).join(" · ")}</span>`
          : ""
      }</div>`;
    case "heading":
      return `<div class="el heading">${escapeHtml(el.text)}</div>`;
    case "text":
      return `<div class="el text">${escapeHtml(el.text)}</div>`;
    case "button":
      return `<button class="el button ${el.variant ?? "primary"}">${escapeHtml(el.label)}</button>`;
    case "input":
      return `<label class="el input">${escapeHtml(el.label)}<input placeholder="${escapeHtml(el.placeholder ?? "")}" /></label>`;
    case "searchbar":
      return `<input class="el searchbar" placeholder="${escapeHtml(el.placeholder ?? "Search")}" />`;
    case "image":
      return `<div class="el image">${escapeHtml(el.label ?? "Image")}</div>`;
    case "list":
      return `<ul class="el list">${el.items
        .map(
          (item) =>
            `<li>${item.hasImage ? '<span class="thumb"></span>' : ""}<strong>${escapeHtml(item.title)}</strong>${item.subtitle ? ` <span class="muted">${escapeHtml(item.subtitle)}</span>` : ""}</li>`,
        )
        .join("")}</ul>`;
    case "card":
      return `<div class="el card">${el.hasImage ? '<div class="thumb"></div>' : ""}<strong>${escapeHtml(el.title)}</strong>${el.body ? `<div class="muted">${escapeHtml(el.body)}</div>` : ""}</div>`;
    case "row":
      return `<div class="el row">${el.children.map(renderElement).join("")}</div>`;
    case "tabbar":
      return `<div class="el tabbar">${el.tabs
        .map(
          (tab, i) =>
            `<span class="${i === el.active ? "active" : ""}">${escapeHtml(tab)}</span>`,
        )
        .join("")}</div>`;
    case "divider":
      return `<hr class="el divider" />`;
    case "avatar":
      return `<div class="el avatar">${escapeHtml(el.name ?? "?")}</div>`;
  }
}

function renderScreen(screen: Screen): string {
  return `<section class="screen">
    <h2>${escapeHtml(screen.name)}</h2>
    <div class="stack">${screen.elements.map(renderElement).join("")}</div>
  </section>`;
}

const STYLES = `
  body { font-family: -apple-system, sans-serif; background: #f4f4f5; margin: 0; padding: 32px; color: #18181b; }
  h1 { font-size: 20px; margin-bottom: 24px; }
  .screens { display: flex; gap: 24px; flex-wrap: wrap; }
  .screen { background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 16px; width: 320px; }
  .screen h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; margin: 0 0 12px; }
  .stack { display: flex; flex-direction: column; gap: 8px; }
  .el { font-size: 14px; }
  .navbar { display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid #e4e4e7; }
  .heading { font-size: 18px; font-weight: 600; }
  .button { border: none; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
  .button.primary { background: #18181b; color: #fff; }
  .button.secondary { background: #e4e4e7; color: #18181b; }
  .input { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #71717a; }
  .input input, .searchbar { border: 1px solid #d4d4d8; border-radius: 8px; padding: 8px; font-size: 14px; }
  .image { background: #e4e4e7; border-radius: 8px; padding: 32px; text-align: center; color: #71717a; }
  .card { border: 1px solid #e4e4e7; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
  .card .thumb, .list .thumb { background: #e4e4e7; border-radius: 6px; width: 100%; height: 60px; margin-bottom: 4px; display: inline-block; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .tabbar { display: flex; justify-content: space-around; border-top: 1px solid #e4e4e7; padding-top: 8px; }
  .tabbar .active { font-weight: 600; }
  .divider { border: none; border-top: 1px solid #e4e4e7; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; background: #e4e4e7; display: flex; align-items: center; justify-content: center; font-size: 12px; }
  .muted { color: #71717a; font-size: 12px; }
  .flow-list { list-style: none; padding: 0; }
  .flow-list li { background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
  .flow-edges { color: #71717a; font-size: 13px; margin-top: 24px; }

  /* -- Design brief document chrome --------------------------------- */
  .doc-header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .doc-header h1 { font-size: 22px; margin: 0; }
  .doc-label { display: inline-block; background: #1F7A4D; color: #fff; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; border-radius: 9999px; padding: 3px 10px; }
  .doc-date { color: #71717a; font-size: 12px; }
  .doc-section { margin-top: 40px; }
  .doc-section h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #71717a; margin: 0 0 12px; }
  .brief-text { background: #fff; border: 1px solid #e4e4e7; border-left: 3px solid #3FBA6A; border-radius: 8px; padding: 16px; font-size: 15px; line-height: 1.5; white-space: pre-wrap; }
  .direction { background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 16px; font-size: 14px; line-height: 1.6; }
  .direction .order { color: #71717a; }
  .transcript { display: flex; flex-direction: column; gap: 8px; max-width: 640px; }
  .msg { border-radius: 10px; padding: 10px 14px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
  .msg .role { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; opacity: 0.6; }
  .msg.user { align-self: flex-end; background: #1F7A4D; color: #fff; }
  .msg.assistant { align-self: flex-start; background: #fff; border: 1px solid #e4e4e7; color: #18181b; }
  .download-btn { position: fixed; top: 24px; right: 24px; background: #18181b; color: #fff; border: none; border-radius: 9999px; padding: 10px 18px; font-size: 13px; font-weight: 500; cursor: pointer; }
  .download-btn:hover { background: #27272a; }
`;

function renderArtifactBody(artifact: Artifact): string {
  return artifact.kind === "wireframe"
    ? `<div class="screens">${artifact.screens.map(renderScreen).join("")}</div>`
    : `<ul class="flow-list">${artifact.nodes
        .map(
          (node) =>
            `<li><strong>${escapeHtml(node.label)}</strong> <span class="muted">(${escapeHtml(node.type)})</span></li>`,
        )
        .join("")}</ul><div class="flow-edges">${artifact.edges
        .map(
          (edge) =>
            `${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}${edge.label ? ` (${escapeHtml(edge.label)})` : ""}`,
        )
        .join("<br />")}</div>`;
}

// --- Design brief document ----------------------------------------------

function renderDirection(artifact: Artifact): string {
  if (artifact.kind === "wireframe") {
    const names = artifact.screens.map((s) => s.name);
    return `<div class="direction">Wireframe · ${artifact.screens.length} screen${artifact.screens.length === 1 ? "" : "s"}<br />
      <span class="order">${names.map(escapeHtml).join(" → ") || "No screens generated."}</span></div>`;
  }
  const names = artifact.nodes.map((n) => n.label);
  return `<div class="direction">Flow · ${artifact.nodes.length} node${artifact.nodes.length === 1 ? "" : "s"}<br />
    <span class="order">${names.map(escapeHtml).join(" → ") || "No nodes generated."}</span></div>`;
}

function renderBrief(messages: Message[]): string {
  const firstUserMessage = messages.find((m) => m.role === "user")?.text;
  const text = firstUserMessage?.trim()
    ? escapeHtml(firstUserMessage)
    : "No conversation recorded for this artifact.";
  return `<div class="brief-text">${text}</div>`;
}

function renderTranscript(messages: Message[]): string {
  if (messages.length === 0) {
    return `<div class="muted">No transcript available.</div>`;
  }
  return `<div class="transcript">${messages
    .map(
      (m) =>
        `<div class="msg ${m.role}"><span class="role">${m.role}</span>${escapeHtml(m.text)}</div>`,
    )
    .join("")}</div>`;
}

const DOWNLOAD_BUTTON_HTML = `<button type="button" id="riff-download" class="download-btn">Download brief</button>
<script>
  document.getElementById('riff-download').addEventListener('click', function () {
    var clone = document.documentElement.cloneNode(true);
    var btn = clone.querySelector('#riff-download');
    if (btn) btn.remove();
    var html = '<!doctype html>\\n' + clone.outerHTML;
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (document.title || 'design-brief').replace(/[^a-z0-9-_]+/gi, '-') + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
</script>`;

function renderHandoffHtml(artifact: Artifact, messages: Message[]): string {
  const generatedAt = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const kindLabel = artifact.kind === "wireframe" ? "Screens" : "Flow";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(artifact.title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="doc-header">
    <h1>${escapeHtml(artifact.title)}</h1>
    <span class="doc-label">Design brief</span>
    <span class="doc-date">${escapeHtml(generatedAt)}</span>
  </div>

  <div class="doc-section">
    <h3>The brief</h3>
    ${renderBrief(messages)}
  </div>

  <div class="doc-section">
    <h3>Direction</h3>
    ${renderDirection(artifact)}
  </div>

  <div class="doc-section">
    <h3>${kindLabel}</h3>
    ${renderArtifactBody(artifact)}
  </div>

  <div class="doc-section">
    <h3>Transcript</h3>
    ${renderTranscript(messages)}
  </div>

  ${DOWNLOAD_BUTTON_HTML}
</body>
</html>`;
}

// Daytona handoff — spins up a live sandbox that serves a minimal static
// HTML page rendered from an Artifact, and returns its public preview URL.

import { Daytona } from "@daytona/sdk";
import type { Artifact, Screen, Element } from "./artifact";

const PREVIEW_PORT = 8080;
const APP_DIR = "/home/daytona/app";

export interface HandoffResult {
  url: string;
  sandboxId: string;
}

export async function createHandoffPreview(
  artifact: Artifact,
): Promise<HandoffResult> {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is not set");
  }

  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.create({ public: true });

  const html = renderArtifactHtml(artifact);
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
`;

function renderArtifactHtml(artifact: Artifact): string {
  const body =
    artifact.kind === "wireframe"
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

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(artifact.title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>${escapeHtml(artifact.title)}</h1>
  ${body}
</body>
</html>`;
}

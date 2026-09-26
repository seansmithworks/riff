---
version: alpha
name: "Riff — Design System"
---

# Design System: Riff

## Tokens

Source of truth: `src/app/globals.css` (`:root` custom properties, exposed via Tailwind v4 `@theme inline`). This file names roles and judgment; it never repeats a value. If a role needs a new value, change it in `globals.css` once.

| Token | Role |
|---|---|
| `canvas` | App shell / studio floor — the ground everything else sits on |
| `surface` | Panels, message bubbles, wireframe frames |
| `surface-elevated` | Placeholder fills (skeletons, image placeholders) |
| `text-primary` | Headings, primary reading text |
| `text-secondary` | Muted / secondary text |
| `text-tertiary` | Decorative or quiet-only marks — never body text |
| `text-inverse` | Text on a filled accent or dark surface |
| `accent` | Anything with text/an icon-plus-text sitting on it — buttons, active labels, links |
| `accent-decorative` | Fill-only marks with no text on them — mic button, borders, dots |
| `ambient-cyan`, `ambient-lime` | Ambient glow / background wash only |
| `border` | Standard dividers |
| `border-subtle` | Lighter dividers (wireframe frame borders, placeholder edges) |
| `radius-phone` | Phone frame corner radius |

Wireframe-kit surfaces reuse the same tokens as the shell (`surface`, `border-subtle`, `surface-elevated`, `text-primary`, `text-secondary`) — they happen to resolve to the same values, but must stay pinned to those roles even if the shell's own tones ever diverge.

`src/app/dev/ink-options/InkOptions.tsx` is exempt: it interpolates colors at runtime (`mixHex`) and needs literal hex strings to do that math.

## 1. Visual Theme & Atmosphere

A light "studio" workspace — a light gray canvas that reads well projected in a bright room — with wireframe artifacts rendered as pure white objects sitting on top of it, like paper mockups on a light table, now as a full-canvas surface with a floating icon toolbar and logo. Grayscale everywhere except the brand greens, split by legibility role: `accent` for anything with text on it, `accent-decorative` for decorative-only marks, and the two ambient tokens reserved strictly for ambient glow and background hints.

## 2. Color Roles

- **Canvas:** the studio floor — deliberately not the same as `surface`; that's what keeps white artifacts legible on top of it.
- **Surface:** panels, rails, message surfaces.
- **Text primary / secondary:** primary reading text vs. muted/secondary.

### Accent — two-tier, contrast-driven
- **`accent` (deep green):** passes AA with white text on it (5.32:1). Use for anything a person must READ on top of it — primary wireframe buttons, active tab label text, the flow start-node pill, user message bubbles, links, accent-colored text.
- **`accent-decorative` (mid green):** contrast on white is too low for text (2.49:1) — use ONLY where no text sits on the fill: the mic button (carries an icon, not text), focus rings, borders, small status/active-state dots, decision-node outline/tint.
- **Ambient tokens:** the bottom-center voice glow and a very low-opacity background wash behind the canvas dot grid. Never text, never a button fill — the lime token especially is close to illegible on light backgrounds.

### Wireframe Kit (pure white artboards on the light gray canvas)
Frame background is `surface`, with a `border-subtle` border and a subtle drop shadow — this is what keeps phone frames and flow nodes reading as objects sitting *on* the canvas rather than dissolving into it. Placeholder fills use `surface-elevated` with a `border-subtle` edge. Heading/body text use `text-primary`/`text-secondary`.

## 3. Typography

- **Font:** Geist Sans (loaded via `next/font/google` in `layout.tsx`), monospace via Geist Mono.
- **Wireframe kit type scale:** the phone frame renders at 340px wide — roughly 0.87x a real 390px iPhone screen — so the kit uses iOS point sizes scaled down accordingly, each paired with an explicit line-height via Tailwind v4's slash modifier (arbitrary font sizes lose preflight's `line-height: 1.5` mismatch against iOS's ~1.3 otherwise): headings, titles/buttons/navbar/list-card titles, body copy/input values/subtitles, and input labels each get their own fixed size/line-height pair. This scale is local to `src/components/WireframeElement.tsx` and `WireframeCanvas.tsx`; the rest of the app (shell chrome, CopilotKit panel) still uses Tailwind's default text sizes.

## 4. Component Stylings

### Wireframe Elements (`src/components/WireframeElement.tsx`)
- **Primary button:** filled `accent`, white text, pill (`rounded-full`)
- **Secondary button:** outline `border-subtle`, gray text, pill
- **Image placeholder:** `surface-elevated` fill, `border-subtle` border, diagonal cross (SVG), `rounded-md`
- **Input:** white bg, `border-subtle` border, `rounded-md`, label above in uppercase caption style
- **Phone frame:** 340px wide, `radius-phone` corners, white bg, subtle drop shadow, screen name label above

### Flow Nodes (`src/components/FlowNodes.tsx`)
- **Screen:** solid rectangle, white bg, `border-subtle` border
- **Action:** dashed rectangle, `canvas` bg (distinguishes from screen)
- **Decision:** diamond (rotated square), `accent-decorative`-tinted (10% fill, 60% opacity border — no text sits on the fill itself)
- **Start:** filled `accent` pill (text accent — carries white text)
- **End:** filled dark (zinc-900) pill
- **Edges:** animated, `text-secondary` stroke

## 5. Layout Principles

- Full-canvas app shell: no fixed header bar — the Riff logo (`~160px`, top-left) and a floating icon toolbar (top-right, white pill, `border` edge, soft shadow) float over the canvas via fixed positioning. Canvas (flex-1) + conversation panel (340px, collapses to full-width stacked below canvas under `md` breakpoint) fill the remaining viewport. Presentation mode is the default state; the toggle and `Escape` return to normal mode.
- Wireframe canvas: horizontal scroll, screens laid out left to right with 32px gaps.
- Flow canvas: React Flow + dagre, left-to-right rank direction, `fitView` on data change.

## 6. Shapes

| Name | Use |
|------|-----|
| `rounded-md` | Buttons, inputs, image placeholders, flow nodes |
| `rounded-lg` | Cards |
| `rounded-phone` | Phone frame corners |
| `rounded-full` | Pills (buttons, mic button, tabs, terminal flow nodes) |

## 7. Reject these reflexes

- Don't put text or a text-bearing button fill on `accent-decorative` or either ambient token — none pass AA contrast on white.
- Don't let the ambient background wash compete with the artifacts — keep it low-opacity and clearly subordinate.
- Don't let panels/artboards go the same flat gray as the shell — white-on-white-bordered is the pattern, not white-on-white-unbordered.
- Don't add gradients or decorative shadows beyond the single phone-frame drop shadow and the ambient canvas wash.

## 8. Agent Prompt Guide

When generating or editing UI for this project:
- Read this file first for roles, then `src/app/globals.css` for the actual values — don't guess colors, and don't paste a hex literal; use the token (`bg-accent`, `var(--color-accent)`, etc.).
- Light shell = `canvas` / white panels / `border` dividers; wireframe artifacts = pure white with a `border-subtle` border and shadow — never let artifacts sit borderless on the canvas or they disappear.
- Two-tier accent: `accent` for text/button fills, `accent-decorative` for decorative-only marks; the ambient tokens are ambient-only, never for text or fills.
- Artifact schema and its renderers are the contract for next wave (voice + AI generation) — see `src/lib/artifact.ts`.

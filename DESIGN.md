---
version: alpha
name: "Riff — Design System"
colors:
  # Backgrounds (light studio canvas)
  background: "#f4f4f5"      # zinc-100, app shell / canvas ground
  surface: "#ffffff"         # white, panels/message surfaces
  surfaceElevated: "#e4e4e7" # zinc-200, borders/dividers
  # Text
  textPrimary: "#18181b"     # zinc-900
  textSecondary: "#71717a"   # zinc-500
  textTertiary: "#a1a1aa"    # zinc-400 (decorative/quiet only, not for body text)
  textInverse: "#fafafa"
  # Brand — two-tier accent (contrast-driven), plus ambient-only hints
  accentText: "#1F7A4D"      # deep green — text/button-fill accent (5.32:1 on white, passes AA)
  accentDecorative: "#3FBA6A" # mid green — decorative-only (icons, borders, mic fill, dots; not for text)
  ambientCyan: "#00F5F1"      # ambient only — voice glow / background hints, never text or fills
  ambientLime: "#B7FF00"      # ambient only — voice glow / background hints, never text or fills
  # Borders (light shell)
  border: "#e4e4e7"          # zinc-200
  borderSubtle: "#d4d4d8"    # zinc-300
  # Wireframe kit (pure white artboards on the light gray canvas)
  wireframeBg: "#ffffff"
  wireframePlaceholder: "#e4e4e7" # zinc-200, image/skeleton fill
  wireframeBorder: "#d4d4d8"      # zinc-300
  wireframeTextPrimary: "#18181b" # zinc-900, headings
  wireframeTextSecondary: "#71717a" # zinc-500, body/labels
typography:
  fontFamily: "Geist Sans (next/font/google), fallback: system-ui, sans-serif"
  monoFamily: "Geist Mono"
spacing:
  xs: 4
  sm: 8
  md: 12
  lg: 16
  xl: 24
  xxl: 32
rounded:
  md: "8px"
  lg: "12px"
  xl: "28px"   # phone frame corners
  full: "9999px"
---

# Design System: Riff

## 1. Visual Theme & Atmosphere

A light "studio" workspace — a light gray canvas that reads well projected in a bright room — with wireframe artifacts rendered as pure white objects sitting on top of it, like paper mockups on a light table, now as a full-canvas surface with a floating icon toolbar and logo. Grayscale everywhere except the brand greens, split by legibility role: deep green (`#1F7A4D`) for anything with text on it, mid green (`#3FBA6A`) for decorative-only marks, and cyan/lime (`#00F5F1` / `#B7FF00`) reserved strictly for ambient glow and background hints.

## 2. Color Palette & Roles

### App Shell (light)
- **Background / canvas ground:** `#f4f4f5` (zinc-100) — NOT white; this is what keeps white artifacts legible on top of it
- **Panels / rails / message surfaces:** `#ffffff` (white)
- **Borders / dividers:** `#e4e4e7` (zinc-200)
- **Primary text:** `#18181b` (zinc-900)
- **Secondary / muted text:** `#71717a` (zinc-500)

### Accent — two-tier, contrast-driven
- **Text/button accent — `#1F7A4D` (deep green):** white text on it = 5.32:1, passes AA. Use for anything a person must READ on top of it: primary wireframe buttons, active tab label text, flow start-node pill (white text), user message bubbles, links, accent-colored text.
- **Decorative accent — `#3FBA6A` (mid green):** contrast on white is too low for text (2.49:1) — use ONLY where no text sits on the fill: the mic button (carries an icon, not text), focus rings, borders, small status/active-state dots, decision-node outline/tint.
- **Ambient only — `#00F5F1` (cyan) / `#B7FF00` (lime):** the bottom-center voice glow and a very low-opacity background wash behind the canvas dot grid. Never text, never a button fill — lime especially is close to illegible on light backgrounds (1.21:1).

### Wireframe Kit (pure white artboards on the light gray canvas)
- **Frame background:** `#ffffff`, with a `#d4d4d8` (zinc-300) border and a subtle drop shadow — this is what keeps phone frames and flow nodes reading as objects sitting *on* the canvas rather than dissolving into it
- **Placeholder fill (images/skeletons):** `#e4e4e7` (zinc-200)
- **Placeholder border:** `#d4d4d8` (zinc-300)
- **Heading / primary text:** `#18181b` (zinc-900)
- **Body / label text:** `#71717a` (zinc-500)

## 3. Typography

- **Font:** Geist Sans (loaded via `next/font/google` in `layout.tsx`), monospace via Geist Mono.
- No custom type scale was needed for this wave — headings/labels use Tailwind's default text sizes (`text-xs` through `text-lg`) at weights 400/500/600. Extend this section if the UI grows beyond the artifact canvas + conversation panel.

## 4. Component Stylings

### Wireframe Elements (`src/components/WireframeElement.tsx`)
- **Primary button:** filled `#1F7A4D`, white text, pill (`rounded-full`)
- **Secondary button:** outline `#d4d4d8` border, `#3f3f46`-ish gray text, pill
- **Image placeholder:** `#e4e4e7` fill, `#d4d4d8` border, diagonal cross (SVG), `rounded-md`
- **Input:** white bg, `#d4d4d8` border, `rounded-md`, label above in uppercase caption style
- **Phone frame:** 340px wide, `rounded-[28px]`, white bg, subtle drop shadow, screen name label above

### Flow Nodes (`src/components/FlowNodes.tsx`)
- **Screen:** solid rectangle, white bg, `#d4d4d8` border
- **Action:** dashed rectangle, `#f4f4f5` bg (distinguishes from screen)
- **Decision:** diamond (rotated square), decorative-accent-tinted (`#3FBA6A` at 10% fill, `#3FBA6A` border at 60% opacity — no text sits on the fill itself)
- **Start:** filled `#1F7A4D` pill (text accent — carries white text)
- **End:** filled dark (zinc-900) pill
- **Edges:** animated, `#71717a` stroke

## 5. Layout Principles

- Full-canvas app shell: no fixed header bar — the Riff logo (`~160px`, top-left) and a floating icon toolbar (top-right, white pill, zinc-200 border, soft shadow) float over the canvas via fixed positioning. Canvas (flex-1) + conversation panel (340px, collapses to full-width stacked below canvas under `md` breakpoint) fill the remaining viewport. Presentation mode is the default state; the toggle and `Escape` return to normal mode.
- Wireframe canvas: horizontal scroll, screens laid out left to right with 32px gaps.
- Flow canvas: React Flow + dagre, left-to-right rank direction, `fitView` on data change.

## 6. Shapes

| Name | Value | Use |
|------|-------|-----|
| `rounded-md` | 8px | Buttons, inputs, image placeholders, flow nodes |
| `rounded-lg` | 12px | Cards |
| `rounded-[28px]` | 28px | Phone frame corners |
| `rounded-full` | 9999px | Pills (buttons, mic button, tabs, terminal flow nodes) |

## 7. Do's and Don'ts

### Do
- Use `#1F7A4D` for anything with text on it; use `#3FBA6A` only where no text sits on the fill (icons, borders, dots)
- Keep `#00F5F1` / `#B7FF00` strictly ambient — voice glow and a low-opacity background wash, never text or a button fill
- Keep wireframe frames pure white with a zinc-300 border, regardless of the light shell — the border + shadow is what keeps the figure/ground contrast the design depends on
- Match button/input radii to `rounded-md` throughout the wireframe kit

### Don't
- Don't put text or a text-bearing button fill on `#3FBA6A`, `#00F5F1`, or `#B7FF00` — none pass AA contrast on white
- Don't let the ambient background wash compete with the artifacts — keep it low-opacity and clearly subordinate
- Don't let panels/artboards go the same flat gray as the shell — white-on-white-bordered is the pattern, not white-on-white-unbordered
- Don't add gradients or decorative shadows beyond the single phone-frame drop shadow and the ambient canvas wash

## 8. Agent Prompt Guide

When generating or editing UI for this project:
- Read this file first for exact values — don't guess colors
- Light shell = zinc-100 canvas / white panels / zinc-200 borders; wireframe artifacts = pure white with a zinc-300 border and shadow — never let artifacts sit borderless on the canvas or they disappear
- Two-tier accent: `#1F7A4D` for text/button fills, `#3FBA6A` for decorative-only marks; `#00F5F1` / `#B7FF00` are ambient-only, never for text or fills
- Artifact schema and its renderers are the contract for next wave (voice + AI generation) — see `src/lib/artifact.ts`

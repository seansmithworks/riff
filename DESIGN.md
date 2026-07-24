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
  # Brand
  accent: "#ff6b4a"          # coral — the one accent color, used sparingly, unchanged
  accentSubtle: "rgba(255, 107, 80, 0.12)"
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

A light "studio" workspace — a light gray canvas that reads well projected in a bright room — with wireframe artifacts rendered as pure white objects sitting on top of it, like paper mockups on a light table. Grayscale everywhere except one warm accent (coral, `#ff6b4a`) reserved for primary actions and focal points: the mic button, primary wireframe buttons, the active tab, flow start/decision nodes.

## 2. Color Palette & Roles

### App Shell (light)
- **Background / canvas ground:** `#f4f4f5` (zinc-100) — NOT white; this is what keeps white artifacts legible on top of it
- **Panels / rails / message surfaces:** `#ffffff` (white)
- **Borders / dividers:** `#e4e4e7` (zinc-200)
- **Primary text:** `#18181b` (zinc-900)
- **Secondary / muted text:** `#71717a` (zinc-500)

### Accent
- **Coral:** `#ff6b4a` — the single accent color, unchanged from the dark-shell version. Used for: mic button, primary wireframe buttons, active tab label, flow start node, decision node outline, user message bubbles.

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
- **Primary button:** filled `#ff6b4a`, white text, pill (`rounded-full`)
- **Secondary button:** outline `#d4d4d8` border, `#3f3f46`-ish gray text, pill
- **Image placeholder:** `#e4e4e7` fill, `#d4d4d8` border, diagonal cross (SVG), `rounded-md`
- **Input:** white bg, `#d4d4d8` border, `rounded-md`, label above in uppercase caption style
- **Phone frame:** 340px wide, `rounded-[28px]`, white bg, subtle drop shadow, screen name label above

### Flow Nodes (`src/components/FlowNodes.tsx`)
- **Screen:** solid rectangle, white bg, `#d4d4d8` border
- **Action:** dashed rectangle, `#f4f4f5` bg (distinguishes from screen)
- **Decision:** diamond (rotated square), accent-tinted (`rgba(255,107,80,0.1)` fill, `#ff6b4a` border at 60% opacity)
- **Start:** filled coral pill
- **End:** filled dark (zinc-900) pill
- **Edges:** animated, `#71717a` stroke

## 5. Layout Principles

- Full-viewport app shell: header (fixed height) → canvas (flex-1) + conversation panel (340px, collapses to full-width stacked below canvas under `md` breakpoint).
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
- Keep the accent (`#ff6b4a`) reserved for focal/primary elements only — everything else stays grayscale
- Keep wireframe frames pure white with a zinc-300 border, regardless of the light shell — the border + shadow is what keeps the figure/ground contrast the design depends on
- Match button/input radii to `rounded-md` throughout the wireframe kit

### Don't
- Don't introduce a second accent color
- Don't tint the shell chrome with the accent (it's for artifacts and the mic button only)
- Don't let panels/artboards go the same flat gray as the shell — white-on-white-bordered is the pattern, not white-on-white-unbordered
- Don't add gradients or decorative shadows beyond the single phone-frame drop shadow

## 8. Agent Prompt Guide

When generating or editing UI for this project:
- Read this file first for exact values — don't guess colors
- Light shell = zinc-100 canvas / white panels / zinc-200 borders; wireframe artifacts = pure white with a zinc-300 border and shadow — never let artifacts sit borderless on the canvas or they disappear
- One accent only: `#ff6b4a` (coral)
- Artifact schema and its renderers are the contract for next wave (voice + AI generation) — see `src/lib/artifact.ts`

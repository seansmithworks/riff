---
version: alpha
name: "Riff — Design System"
colors:
  # Backgrounds (dark studio canvas)
  background: "#09090b"      # zinc-950, app shell
  surface: "#18181b"         # zinc-900, panels/messages
  surfaceElevated: "#27272a" # zinc-800, borders/dividers
  # Text
  textPrimary: "#fafafa"     # zinc-50
  textSecondary: "#a1a1aa"   # zinc-400
  textTertiary: "#71717a"    # zinc-500
  textInverse: "#09090b"
  # Brand
  accent: "#ff6b4a"          # coral — the one accent color, used sparingly
  accentSubtle: "rgba(255, 107, 80, 0.12)"
  # Borders (dark shell)
  border: "#27272a"          # zinc-800
  borderSubtle: "#3f3f46"    # zinc-700
  # Wireframe kit (light "paper" frames rendered on the dark canvas)
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

A dark "studio" workspace that gets out of the way, with wireframe artifacts rendered as bright, crisp objects floating on the dark canvas — like paper mockups on a lightbox. Grayscale everywhere except one warm accent (coral, `#ff6b4a`) reserved for primary actions and focal points: the mic button, primary wireframe buttons, the active tab, flow start/decision nodes.

## 2. Color Palette & Roles

### App Shell (dark)
- **Background:** `#09090b` (zinc-950)
- **Panels / message bubbles:** `#18181b` (zinc-900)
- **Borders / dividers:** `#27272a` (zinc-800)
- **Primary text:** `#fafafa`
- **Secondary text:** `#a1a1aa`
- **Tertiary text:** `#71717a`

### Accent
- **Coral:** `#ff6b4a` — the single accent color. Used for: mic button, primary wireframe buttons, active tab label, flow start node, decision node outline, user message bubbles.

### Wireframe Kit (light frames on dark canvas)
- **Frame background:** `#ffffff`
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
- Keep wireframe frames white/light regardless of the dark shell — the contrast is the point
- Match button/input radii to `rounded-md` throughout the wireframe kit

### Don't
- Don't introduce a second accent color
- Don't tint the dark shell chrome with the accent (it's for artifacts and the mic button only)
- Don't add gradients or decorative shadows beyond the single phone-frame drop shadow

## 8. Agent Prompt Guide

When generating or editing UI for this project:
- Read this file first for exact values — don't guess colors
- Dark shell = zinc-950/900/800 scale; wireframe artifacts = white/zinc-200/zinc-300 scale
- One accent only: `#ff6b4a` (coral)
- Artifact schema and its renderers are the contract for next wave (voice + AI generation) — see `src/lib/artifact.ts`

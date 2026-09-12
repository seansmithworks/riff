// Dot-grid "sketchbook paper" — a first-class, addressable buffer so the
// fluid glow (texture read), the ink-bleed hook, and Phase B's spark-landing
// can each light/tint individual dots instead of drawing a flat CSS
// background. See voice-lab-dotgrid-addendum.md §1.
//
// Per-dot state lives in preallocated typed arrays (never resized after
// construction): `ink` (0-1, how "inked" the paper impression under this dot
// is) and `tintR/G/B` + `tintAmount` (0-1, how far the dot's rendered color
// has lerped toward that tint) . A static base layer (plain gray dots at
// `baseOpacity`) is rendered once to an offscreen canvas; every frame we
// blit that cached image, then redraw only the dots that are inked/tinted
// above a negligible threshold ("dirty"), so idle cost is one drawImage call.
export class DotGrid {
  readonly w: number;
  readonly h: number;
  readonly pitch: number;
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  dotSize: number;
  baseOpacity: number;

  // Per-dot state, indexed by `row * cols + col`.
  ink: Float32Array;
  tintR: Uint8Array;
  tintG: Uint8Array;
  tintB: Uint8Array;
  tintAmount: Float32Array;

  // Field-driven wash tint — a separate channel from tintR/G/B/tintAmount
  // above. That channel is an additive impulse (bleedAlongPath: pigment
  // pools and settles over several frames), so a live per-frame source like
  // the fluid wash would saturate it to 1 within a couple of frames
  // regardless of how faint the wash is there. setFieldTint instead assigns
  // (never accumulates) — the engine calls it every frame with the wash's
  // own current soft alpha, so the dot always mirrors the wash instead of
  // drifting independently of it.
  fieldTintR: Uint8Array;
  fieldTintG: Uint8Array;
  fieldTintB: Uint8Array;
  fieldTintAmount: Float32Array;

  private dotX: Float32Array;
  private dotY: Float32Array;
  private base: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private dirty: Set<number> = new Set();

  constructor(
    w: number,
    h: number,
    pitch: number,
    dotSize: number,
    baseOpacity: number,
  ) {
    this.w = w;
    this.h = h;
    this.pitch = pitch;
    this.dotSize = dotSize;
    this.baseOpacity = baseOpacity;
    this.cols = Math.max(1, Math.floor((w - 40) / pitch) + 1);
    this.rows = Math.max(1, Math.floor((h - 40) / pitch) + 1);
    this.count = this.cols * this.rows;
    this.ink = new Float32Array(this.count);
    this.tintR = new Uint8Array(this.count);
    this.tintG = new Uint8Array(this.count);
    this.tintB = new Uint8Array(this.count);
    this.tintAmount = new Float32Array(this.count);
    this.fieldTintR = new Uint8Array(this.count);
    this.fieldTintG = new Uint8Array(this.count);
    this.fieldTintB = new Uint8Array(this.count);
    this.fieldTintAmount = new Float32Array(this.count);
    this.dotX = new Float32Array(this.count);
    this.dotY = new Float32Array(this.count);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        this.dotX[i] = 20 + col * pitch;
        this.dotY[i] = 20 + row * pitch;
      }
    }
    this.base = document.createElement("canvas");
    this.base.width = w;
    this.base.height = h;
    this.baseCtx = this.base.getContext("2d")!;
    this.renderBase();
  }

  // Rebuilds the cached base layer — called on construction and whenever
  // Pitch/Dot size/Base opacity change (rare, from the Paper panel).
  renderBase() {
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = `rgba(212,212,216,${this.baseOpacity})`;
    for (let i = 0; i < this.count; i++) {
      ctx.beginPath();
      ctx.arc(this.dotX[i], this.dotY[i], this.dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  setDotSize(v: number) {
    if (v === this.dotSize) return;
    this.dotSize = v;
    this.renderBase();
  }

  setBaseOpacity(v: number) {
    if (v === this.baseOpacity) return;
    this.baseOpacity = v;
    this.renderBase();
  }

  // Nearest dot index to a world-space point, or -1 if the grid is empty.
  nearestDot(x: number, y: number): number {
    if (this.count === 0) return -1;
    const col = Math.round((x - 20) / this.pitch);
    const row = Math.round((y - 20) / this.pitch);
    const c = Math.max(0, Math.min(this.cols - 1, col));
    const r = Math.max(0, Math.min(this.rows - 1, row));
    return r * this.cols + c;
  }

  // Bumps a dot's ink toward 1 by `strength` (0-1), marking it dirty for
  // redraw this frame.
  lightDot(i: number, strength: number) {
    if (i < 0 || i >= this.count) return;
    this.ink[i] = Math.min(1, this.ink[i] + strength);
    this.dirty.add(i);
  }

  // Lerps a dot's tint color toward rgb by `amount` (0-1 additive, clamped),
  // marking it dirty for redraw this frame.
  setTint(i: number, rgb: [number, number, number], amount: number) {
    if (i < 0 || i >= this.count) return;
    this.tintR[i] = rgb[0];
    this.tintG[i] = rgb[1];
    this.tintB[i] = rgb[2];
    this.tintAmount[i] = Math.min(1, this.tintAmount[i] + amount);
    this.dirty.add(i);
  }

  // Exponential decay of ink/tint toward 0, applied every frame. `dt` in ms.
  // fieldTintAmount is deliberately not decayed here — engine.ts rewrites or
  // clears it fresh every frame straight from the wash's own alpha (see
  // setFieldTint above), so it always mirrors the wash rather than lingering
  // on its own schedule.
  decay(dt: number) {
    const rate = Math.pow(0.985, dt / 16.7);
    for (const i of this.dirty) {
      this.ink[i] *= rate;
      this.tintAmount[i] *= rate;
      if (
        this.ink[i] < 0.004 &&
        this.tintAmount[i] < 0.004 &&
        this.fieldTintAmount[i] < 0.004
      ) {
        this.ink[i] = 0;
        this.tintAmount[i] = 0;
        this.fieldTintAmount[i] = 0;
        this.dirty.delete(i);
      }
    }
  }

  // Assigns (never accumulates) this dot's wash-tint for the current frame —
  // see the fieldTintAmount fields' doc comment above for why this can't
  // reuse setTint's additive model.
  setFieldTint(i: number, rgb: [number, number, number], amount: number) {
    if (i < 0 || i >= this.count) return;
    const clamped = Math.max(0, Math.min(1, amount));
    if (clamped < 0.003 && this.fieldTintAmount[i] < 0.003) return;
    this.fieldTintR[i] = rgb[0];
    this.fieldTintG[i] = rgb[1];
    this.fieldTintB[i] = rgb[2];
    this.fieldTintAmount[i] = clamped;
    this.dirty.add(i);
  }

  // Stroke-bleed primitive (voice-lab-dotgrid-addendum.md §4): tints dots
  // within `8 + amount*6` px (8-14px) of each sample point in the given
  // color, falling off with distance — a faint granulated wash pooling
  // against a freshly inked pen line. `samples` is typically a single
  // {x,y} point (the ink head's current position); frames.ts's reveal hook
  // calls this once per frame per actively-inking element.
  bleedAlongPath(
    samples: { x: number; y: number }[],
    color: [number, number, number],
    amount: number,
  ) {
    if (amount <= 0) return;
    const radius = 8 + Math.max(0, Math.min(1, amount)) * 6;
    const cellRadius = Math.ceil(radius / this.pitch) + 1;
    for (const s of samples) {
      const baseCol = Math.round((s.x - 20) / this.pitch);
      const baseRow = Math.round((s.y - 20) / this.pitch);
      for (let dr = -cellRadius; dr <= cellRadius; dr++) {
        const row = baseRow + dr;
        if (row < 0 || row >= this.rows) continue;
        for (let dc = -cellRadius; dc <= cellRadius; dc++) {
          const col = baseCol + dc;
          if (col < 0 || col >= this.cols) continue;
          const i = row * this.cols + col;
          const dx = this.dotX[i] - s.x;
          const dy = this.dotY[i] - s.y;
          const dist = Math.hypot(dx, dy);
          if (dist > radius) continue;
          const falloff = 1 - dist / radius;
          this.setTint(i, color, falloff * amount * 0.35);
        }
      }
    }
  }

  x(i: number) {
    return this.dotX[i];
  }
  y(i: number) {
    return this.dotY[i];
  }

  // Draws the cached base layer, then only the dirty dots on top — idle cost
  // (empty `dirty`) is a single drawImage.
  draw(ctx: CanvasRenderingContext2D) {
    ctx.drawImage(this.base, 0, 0);
    if (this.dirty.size === 0) return;
    for (const i of this.dirty) {
      const ink = this.ink[i];
      const bleedAmount = this.tintAmount[i];
      const fieldAmount = this.fieldTintAmount[i];
      const totalTint = Math.min(1, bleedAmount + fieldAmount);
      if (ink < 0.004 && totalTint < 0.004) continue;
      // Blend the two tint sources' colors by their relative share of the
      // total, so a dot touched by both an ink-bleed impulse and the live
      // wash reads as one settled color instead of one silently overwriting
      // the other.
      const share = bleedAmount + fieldAmount;
      const bleedShare = share > 0 ? bleedAmount / share : 0;
      const fieldShare = share > 0 ? fieldAmount / share : 0;
      const tr = this.tintR[i] * bleedShare + this.fieldTintR[i] * fieldShare;
      const tg = this.tintG[i] * bleedShare + this.fieldTintG[i] * fieldShare;
      const tb = this.tintB[i] * bleedShare + this.fieldTintB[i] * fieldShare;
      const r = Math.round(212 + (tr - 212) * totalTint);
      const g = Math.round(212 + (tg - 212) * totalTint);
      const b = Math.round(212 + (tb - 212) * totalTint);
      const size = this.dotSize * (1 + Math.max(ink, totalTint) * 0.6);
      const alpha = Math.min(
        1,
        this.baseOpacity + Math.max(ink, totalTint) * 0.7,
      );
      ctx.beginPath();
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.arc(this.dotX[i], this.dotY[i], size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

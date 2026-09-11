import type { VoiceLabEngine } from "./engine";

// Auto-play demonstrates that voice and job are independent channels: a
// sketch job starts and lands WHILE the conversation keeps going, matching
// render_artifact's fire-and-forget behavior in the real app.
export class Autoplay {
  private token = 0;
  running = false;
  private onChange: ((running: boolean) => void) | null = null;

  constructor(private engine: VoiceLabEngine) {}

  onRunningChange(cb: (running: boolean) => void) {
    this.onChange = cb;
  }

  private sleep(ms: number, token: number): Promise<void> {
    return new Promise((resolve) => {
      const id = setTimeout(resolve, ms);
      const check = setInterval(() => {
        if (token !== this.token) {
          clearTimeout(id);
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  start() {
    if (this.running) return;
    const token = ++this.token;
    this.running = true;
    this.onChange?.(true);
    this.run(token);
  }

  stop() {
    if (!this.running) return;
    this.token++;
    this.running = false;
    this.onChange?.(false);
  }

  private async run(token: number) {
    while (token === this.token) {
      this.engine.setVoiceState("idle");
      await this.sleep(1200, token);
      if (token !== this.token) break;

      this.engine.setVoiceState("riff-talking");
      await this.sleep(1500, token);
      if (token !== this.token) break;

      // Sketch job starts while Riff is still talking — voice keeps going.
      this.engine.startSketch();
      await this.sleep(1800, token);
      if (token !== this.token) break;

      this.engine.setVoiceState("you-talking");
      await this.sleep(3200, token);
      if (token !== this.token) break;

      this.engine.setVoiceState("riff-talking");
      await this.sleep(2000, token);
      if (token !== this.token) break;

      // Render lands mid-conversation, while Riff's arcs are still drawing.
      this.engine.landNow();
      await this.sleep(1400, token);
      if (token !== this.token) break;

      this.engine.setVoiceState("silence");
      await this.sleep(1800, token);
      if (token !== this.token) break;

      this.engine.setJobState("none");
      await this.sleep(600, token);
      if (token !== this.token) break;
    }
    this.running = false;
    this.onChange?.(false);
  }
}

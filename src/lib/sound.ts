// Web Audio API synthesizer for TzDeck pack opening and card reveals
class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  // Play sound for opening/ripping the booster pack foil
  public playPackRip() {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // White noise burst for foil tear
    const bufferSize = ctx.sampleRate * 0.35;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.08));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + 0.35);
  }

  // Play sound for flipping/revealing a card
  public playCardFlip(rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" = "common") {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Base card swish
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "sine";
    const baseFreq = rarity === "legendary" ? 523.25 : rarity === "epic" ? 440 : rarity === "rare" ? 392 : 329.63;
    
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.15);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);

    // Chime sparkle for rare+
    if (rarity === "rare" || rarity === "epic" || rarity === "legendary") {
      const notes = rarity === "legendary" ? [523.25, 659.25, 783.99, 1046.5] : rarity === "epic" ? [440, 554.37, 659.25] : [392, 493.88];
      notes.forEach((freq, idx) => {
        const chime = ctx.createOscillator();
        const chimeGain = ctx.createGain();
        chime.type = "triangle";
        chime.frequency.setValueAtTime(freq, now + idx * 0.06);

        chimeGain.gain.setValueAtTime(0.12, now + idx * 0.06);
        chimeGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.3);

        chime.connect(chimeGain);
        chimeGain.connect(ctx.destination);

        chime.start(now + idx * 0.06);
        chime.stop(now + idx * 0.06 + 0.35);
      });
    }
  }

  // Play fanfare when completing a pack reveal
  public playPackComplete() {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const chords = [523.25, 659.25, 783.99, 1046.5];
    chords.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.15, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.65);
    });
  }
}

export const soundManager = new SoundManager();

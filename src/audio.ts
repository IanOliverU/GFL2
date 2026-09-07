// Restrained synthesized audio: no assets required, safe if AudioContext blocked.
export interface Settings {
  master: number; sfx: number; ui: number;
  shake: boolean; sensitivity: number; debug: boolean;
  reverseForward: boolean; reverseStrafe: boolean; invertLookX: boolean; invertLookY: boolean;
  bestTime: number; bestLevel: number; bestLoop: number; wins: number;
}

const SETTINGS_KEY = "gfl2-roguelite-settings-v1";

export function defaultSettings(): Settings {
  return {
    master: 0.7, sfx: 0.8, ui: 0.6, shake: true, sensitivity: 1.0, debug: false,
    // Hotfixed polarity requested for the shipped control profile. Each axis can
    // still be changed independently from Settings without rebuilding the game.
    // Verified player mapping: W/S use the forward basis, A/D retain the
    // previously-correct strafe polarity, and vertical look is not inverted.
    reverseForward: false, reverseStrafe: true, invertLookX: true, invertLookY: false,
    bestTime: 0, bestLevel: 0, bestLoop: 0, wins: 0,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return defaultSettings();
    const source = parsed as Partial<Record<keyof Settings, unknown>>;
    const defaults = defaultSettings();
    const bounded = (key: keyof Settings, min: number, max: number): number => {
      const value = source[key];
      return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : defaults[key] as number;
    };
    return {
      master: bounded("master", 0, 1),
      sfx: bounded("sfx", 0, 1),
      ui: bounded("ui", 0, 1),
      sensitivity: bounded("sensitivity", 0.3, 2.5),
      shake: typeof source.shake === "boolean" ? source.shake : defaults.shake,
      debug: typeof source.debug === "boolean" ? source.debug : defaults.debug,
      reverseForward: typeof source.reverseForward === "boolean" ? source.reverseForward : defaults.reverseForward,
      reverseStrafe: typeof source.reverseStrafe === "boolean" ? source.reverseStrafe : defaults.reverseStrafe,
      invertLookX: typeof source.invertLookX === "boolean" ? source.invertLookX : defaults.invertLookX,
      invertLookY: typeof source.invertLookY === "boolean" ? source.invertLookY : defaults.invertLookY,
      bestTime: Math.floor(bounded("bestTime", 0, 1e9)),
      bestLevel: Math.floor(bounded("bestLevel", 0, 1e6)),
      bestLoop: Math.floor(bounded("bestLoop", 0, 1e6)),
      wins: Math.floor(bounded("wins", 0, 1e6)),
    };
  } catch { return defaultSettings(); }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

class Synth {
  private ctx: AudioContext | null = null;
  settings: Settings = defaultSettings();

  ensure(): AudioContext | null {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
      return this.ctx;
    } catch { return null; }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0): void {
    if (vol * this.settings.master * this.settings.sfx <= 0) return;
    const ctx = this.ensure();
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide !== 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
      const v = vol * this.settings.master * this.settings.sfx;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch { /* ignore */ }
  }

  private noise(dur: number, vol: number, lowpass = 1200, delay = 0): void {
    if (vol * this.settings.master * this.settings.sfx <= 0) return;
    const ctx = this.ensure();
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + delay;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = lowpass;
      const g = ctx.createGain();
      g.gain.value = vol * this.settings.master * this.settings.sfx;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t0);
    } catch { /* ignore */ }
  }

  fire(kind: string): void {
    if (kind === "RF") { this.noise(0.16, 0.5, 900); this.tone(140, 0.14, "square", 0.25, -80); }
    else if (kind === "SG") { this.noise(0.2, 0.55, 700); this.tone(95, 0.16, "square", 0.3, -40); }
    else if (kind === "MG") { this.noise(0.08, 0.32, 1400); this.tone(190, 0.07, "square", 0.16, -60); }
    else { this.noise(0.09, 0.36, 1800); this.tone(220, 0.07, "sawtooth", 0.14, -90); }
  }
  impact(): void { this.noise(0.06, 0.22, 2500); }
  hurt(): void { this.tone(130, 0.18, "sawtooth", 0.3, -50); }
  ability(): void { this.tone(440, 0.16, "triangle", 0.3, 220); this.tone(660, 0.14, "triangle", 0.22, 160, 0.07); }
  ult(): void { this.tone(220, 0.4, "sawtooth", 0.3, 330); this.noise(0.3, 0.2, 3000, 0.05); }
  pickup(): void { this.tone(760, 0.09, "sine", 0.25, 240); }
  levelup(): void { this.tone(523, 0.12, "triangle", 0.3); this.tone(659, 0.12, "triangle", 0.3, 0, 0.1); this.tone(784, 0.2, "triangle", 0.32, 0, 0.2); }
  ui(): void {
    if (this.settings.master * this.settings.ui <= 0) return;
    const ctx = this.ensure(); if (!ctx) return;
    try {
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 620;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.25 * this.settings.master * this.settings.ui), t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.09);
    } catch { /* ignore */ }
  }
  reload(): void { this.tone(300, 0.07, "square", 0.12); this.tone(420, 0.07, "square", 0.12, 0, 0.09); }
  bossWarn(): void { this.tone(98, 0.7, "sawtooth", 0.4, 40); this.tone(147, 0.7, "sawtooth", 0.3, -30, 0.15); }
  explode(): void { this.noise(0.4, 0.5, 500); this.tone(70, 0.35, "sine", 0.4, -30); }
  trap(): void { this.tone(180, 0.25, "square", 0.25, 120); }
}

export const synth = new Synth();

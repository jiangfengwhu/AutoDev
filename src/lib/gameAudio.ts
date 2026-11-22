/**
 * Synthesized Web Audio API game sound effects & cozy studio ambient engine.
 * Zero external audio files — instant response, automatically unlocks on first user gesture.
 */

const SFX_STORAGE_KEY = 'autodev_studio_sfx_enabled';
const BGM_STORAGE_KEY = 'autodev_studio_bgm_enabled';

class StudioGameAudio {
  private ctx: AudioContext | null = null;
  private sfxEnabled: boolean = true;
  private bgmEnabled: boolean = false;
  private ambientNodes: {
    gain: GainNode;
    oscillators: OscillatorNode[];
    lfo?: OscillatorNode;
    noiseSource?: AudioBufferSourceNode;
  } | null = null;
  private lastHoverAt = 0;
  private lastBlipAt = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const storedSfx = window.localStorage.getItem(SFX_STORAGE_KEY);
        if (storedSfx === 'false') this.sfxEnabled = false;
        const storedBgm = window.localStorage.getItem(BGM_STORAGE_KEY);
        if (storedBgm === 'true') this.bgmEnabled = true;
      } catch {
        // ignore storage errors
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && this.bgmEnabled && !this.ambientNodes) {
      this.startAmbientLoop(ctx);
    }
  }

  public isSfxEnabled(): boolean {
    return this.sfxEnabled;
  }

  public isBgmEnabled(): boolean {
    return this.bgmEnabled;
  }

  public setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
    try {
      window.localStorage.setItem(SFX_STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
    if (enabled) {
      this.playUiClick();
    }
  }

  public setBgmEnabled(enabled: boolean): void {
    this.bgmEnabled = enabled;
    try {
      window.localStorage.setItem(BGM_STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
    if (enabled) {
      const ctx = this.ensureContext();
      if (ctx) this.startAmbientLoop(ctx);
    } else {
      this.stopAmbientLoop();
    }
  }

  private startAmbientLoop(ctx: AudioContext): void {
    if (this.ambientNodes) return;
    try {
      const now = ctx.currentTime;
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.exponentialRampToValueAtTime(0.028, now + 1.2);

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(420, now);
      lowpass.Q.setValueAtTime(0.8, now);

      masterGain.connect(lowpass);
      lowpass.connect(ctx.destination);

      // Warm cozy major-7th lo-fi studio pad (Fmaj7: F2, C3, E3, A3)
      const freqs = [87.31, 130.81, 164.81, 220.0];
      const oscillators: OscillatorNode[] = [];

      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.14, now);
      lfoGain.gain.setValueAtTime(95, now);
      lfo.connect(lfoGain);
      lfoGain.connect(lowpass.frequency);
      lfo.start(now);

      for (let i = 0; i < freqs.length; i += 1) {
        const osc = ctx.createOscillator();
        const voiceGain = ctx.createGain();
        osc.type = i % 2 === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freqs[i], now);
        osc.detune.setValueAtTime((i - 1.5) * 4, now);
        voiceGain.gain.setValueAtTime(i === 0 ? 0.35 : 0.22, now);
        osc.connect(voiceGain);
        voiceGain.connect(masterGain);
        osc.start(now);
        oscillators.push(osc);
      }

      this.ambientNodes = { gain: masterGain, oscillators, lfo };
    } catch {
      // ignore audio init error
    }
  }

  private stopAmbientLoop(): void {
    const nodes = this.ambientNodes;
    if (!nodes || !this.ctx) {
      this.ambientNodes = null;
      return;
    }
    try {
      const now = this.ctx.currentTime;
      nodes.gain.gain.cancelScheduledValues(now);
      nodes.gain.gain.setTargetAtTime(0.0001, now, 0.15);
      setTimeout(() => {
        for (const osc of nodes.oscillators) {
          try {
            osc.stop();
            osc.disconnect();
          } catch {
            // ignore
          }
        }
        try {
          nodes.lfo?.stop();
          nodes.lfo?.disconnect();
          nodes.gain.disconnect();
        } catch {
          // ignore
        }
      }, 450);
    } catch {
      // ignore
    }
    this.ambientNodes = null;
  }

  private playTone(params: {
    freq: number;
    endFreq?: number;
    duration: number;
    type?: OscillatorType;
    volume?: number;
    delay?: number;
  }): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + (params.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = params.type ?? 'triangle';
    osc.frequency.setValueAtTime(params.freq, now);
    if (params.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, params.endFreq), now + params.duration);
    }

    const peak = params.volume ?? 0.06;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + Math.min(0.014, params.duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + params.duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + params.duration + 0.02);
  }

  public playFootstep(stepCount: number): void {
    if (!this.sfxEnabled) return;
    const base = stepCount % 2 === 0 ? 132 : 156;
    this.playTone({
      freq: base,
      endFreq: 68,
      duration: 0.055,
      type: 'triangle',
      volume: 0.032,
    });
  }

  public playUiHover(): void {
    if (!this.sfxEnabled) return;
    const now = Date.now();
    if (now - this.lastHoverAt < 65) return;
    this.lastHoverAt = now;
    this.playTone({
      freq: 820,
      endFreq: 960,
      duration: 0.04,
      type: 'sine',
      volume: 0.018,
    });
  }

  public playUiClick(): void {
    if (!this.sfxEnabled) return;
    this.playTone({
      freq: 520,
      endFreq: 310,
      duration: 0.06,
      type: 'triangle',
      volume: 0.05,
    });
  }

  public playDialogueBlip(voicePitchHz = 400): void {
    if (!this.sfxEnabled) return;
    const now = Date.now();
    if (now - this.lastBlipAt < 48) return;
    this.lastBlipAt = now;
    const jitter = (Math.random() - 0.5) * 26;
    this.playTone({
      freq: voicePitchHz + jitter,
      endFreq: voicePitchHz * 1.06,
      duration: 0.042,
      type: 'sine',
      volume: 0.026,
    });
  }

  public playDoorEnter(): void {
    if (!this.sfxEnabled) return;
    this.playTone({ freq: 330, endFreq: 440, duration: 0.14, type: 'triangle', volume: 0.05 });
    this.playTone({ freq: 523.25, endFreq: 659.25, duration: 0.2, type: 'sine', volume: 0.055, delay: 0.065 });
  }

  public playDoorExit(): void {
    if (!this.sfxEnabled) return;
    this.playTone({ freq: 523.25, endFreq: 392, duration: 0.13, type: 'triangle', volume: 0.045 });
    this.playTone({ freq: 392, endFreq: 293.66, duration: 0.16, type: 'sine', volume: 0.04, delay: 0.05 });
  }

  public playQuestStart(): void {
    if (!this.sfxEnabled) return;
    const notes = [440, 554.37, 659.25];
    notes.forEach((freq, idx) => {
      this.playTone({
        freq,
        duration: 0.18,
        type: 'triangle',
        volume: 0.055,
        delay: idx * 0.075,
      });
    });
  }

  public playQuestComplete(): void {
    if (!this.sfxEnabled) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      this.playTone({
        freq,
        duration: idx === notes.length - 1 ? 0.36 : 0.16,
        type: 'triangle',
        volume: 0.06,
        delay: idx * 0.08,
      });
    });
  }

  public playAlertError(): void {
    if (!this.sfxEnabled) return;
    this.playTone({ freq: 220, endFreq: 165, duration: 0.14, type: 'sawtooth', volume: 0.035 });
    this.playTone({ freq: 185, endFreq: 130, duration: 0.18, type: 'sawtooth', volume: 0.032, delay: 0.11 });
  }
}

export const gameAudio = new StudioGameAudio();

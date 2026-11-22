/**
 * Procedural Web Audio API Game Sound & Ambient Lo-Fi Studio BGM Engine.
 * Zero external audio dependencies — works reliably offline and in sandboxed iframes.
 */

class StudioSoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private bgmEnabled = true;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private bgmStep = 0;
  private lastFootstepAt = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.muted) return null;
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
    if (ctx && this.bgmEnabled && !this.bgmTimer) {
      this.startBgm();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(nextMuted: boolean): void {
    this.muted = nextMuted;
    if (nextMuted) {
      this.stopBgm();
    } else if (this.bgmEnabled) {
      this.startBgm();
    }
  }

  public isBgmEnabled(): boolean {
    return this.bgmEnabled;
  }

  public setBgmEnabled(enabled: boolean): void {
    this.bgmEnabled = enabled;
    if (enabled && !this.muted) {
      this.startBgm();
    } else {
      this.stopBgm();
    }
  }

  private playTone(opts: {
    freq: number;
    endFreq?: number;
    duration: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
  }): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = opts.type ?? 'triangle';
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), now + opts.duration);
    }

    const peak = opts.gain ?? 0.08;
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(peak, now + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + opts.duration + 0.02);
  }

  /** Soft pitch-varied studio wooden floor footstep */
  public playFootstep(): void {
    const nowMs = Date.now();
    if (nowMs - this.lastFootstepAt < 230) return;
    this.lastFootstepAt = nowMs;
    const jitter = 0.92 + Math.random() * 0.16;
    this.playTone({
      freq: 145 * jitter,
      endFreq: 68 * jitter,
      duration: 0.055,
      type: 'triangle',
      gain: 0.032,
    });
  }

  /** Subtle hover tick */
  public playUiHover(): void {
    this.playTone({
      freq: 620,
      endFreq: 740,
      duration: 0.04,
      type: 'sine',
      gain: 0.025,
    });
  }

  /** Tactile RPG menu confirm chime */
  public playUiClick(): void {
    this.playTone({ freq: 523.25, duration: 0.06, type: 'triangle', gain: 0.055 });
    this.playTone({ freq: 783.99, duration: 0.08, type: 'triangle', gain: 0.05, delay: 0.045 });
  }

  /** Entering or exiting a studio room */
  public playDoorTransition(): void {
    this.playTone({
      freq: 260,
      endFreq: 440,
      duration: 0.13,
      type: 'sine',
      gain: 0.055,
    });
    this.playTone({
      freq: 659.25,
      duration: 0.16,
      type: 'triangle',
      gain: 0.05,
      delay: 0.07,
    });
  }

  /** Classic RPG character dialogue voice blip */
  public playDialogueBlip(seed = 0): void {
    const base = 360 + ((seed * 53) % 140);
    this.playTone({
      freq: base,
      endFreq: base * 1.12,
      duration: 0.045,
      type: 'square',
      gain: 0.022,
    });
  }

  /** Starting a new PRD / Draft PR / Background mission */
  public playQuestAccept(): void {
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((n, idx) => {
      this.playTone({
        freq: n,
        duration: 0.12,
        type: 'triangle',
        gain: 0.06,
        delay: idx * 0.065,
      });
    });
  }

  /** Background task completed / Level-up fanfare */
  public playTaskComplete(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone({
        freq: n,
        duration: idx === 3 ? 0.28 : 0.11,
        type: 'triangle',
        gain: 0.065,
        delay: idx * 0.08,
      });
    });
  }

  /** Heavy satisfying approval stamp + release sparkle */
  public playStampApprove(): void {
    this.playTone({
      freq: 150,
      endFreq: 55,
      duration: 0.11,
      type: 'triangle',
      gain: 0.11,
    });
    this.playTone({
      freq: 587.33,
      duration: 0.14,
      type: 'sine',
      gain: 0.06,
      delay: 0.09,
    });
    this.playTone({
      freq: 880,
      duration: 0.24,
      type: 'triangle',
      gain: 0.065,
      delay: 0.17,
    });
  }

  /** Retro warning double-buzz */
  public playErrorAlert(): void {
    this.playTone({ freq: 210, endFreq: 165, duration: 0.11, type: 'sawtooth', gain: 0.045 });
    this.playTone({
      freq: 175,
      endFreq: 130,
      duration: 0.15,
      type: 'sawtooth',
      gain: 0.045,
      delay: 0.12,
    });
  }

  /** Gentle cozy 16-bit Lo-Fi pentatonic studio background loop */
  public startBgm(): void {
    if (this.muted || !this.bgmEnabled || this.bgmTimer || typeof window === 'undefined') return;
    // Warm Cmaj9 / Am9 / Fmaj7 / G6 cozy pixel-studio arpeggio
    const melody = [
      261.63, 329.63, 392.0, 493.88,
      220.0, 261.63, 329.63, 392.0,
      174.61, 220.0, 261.63, 329.63,
      196.0, 246.94, 293.66, 392.0,
    ];
    const bass = [130.81, 110.0, 87.31, 98.0];

    this.bgmTimer = setInterval(() => {
      if (this.muted || !this.bgmEnabled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      const note = melody[this.bgmStep % melody.length];
      this.playTone({
        freq: note,
        duration: 0.42,
        type: 'sine',
        gain: 0.015,
      });
      if (this.bgmStep % 4 === 0) {
        const bassNote = bass[Math.floor((this.bgmStep % 16) / 4)];
        this.playTone({
          freq: bassNote,
          duration: 0.85,
          type: 'triangle',
          gain: 0.016,
        });
      }
      this.bgmStep += 1;
    }, 520);
  }

  public stopBgm(): void {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }
}

export const soundEngine = new StudioSoundEngine();

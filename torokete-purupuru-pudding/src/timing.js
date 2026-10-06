export const FRAME_TIMING = Object.freeze({
  fixedStep: 1 / 60,
  maximumFrameDelta: 0.05,
  maximumSubsteps: 4,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export class FixedStepClock {
  constructor(options = {}) {
    this.fixedStep = options.fixedStep ?? FRAME_TIMING.fixedStep;
    this.maximumFrameDelta = options.maximumFrameDelta ?? FRAME_TIMING.maximumFrameDelta;
    this.maximumSubsteps = options.maximumSubsteps ?? FRAME_TIMING.maximumSubsteps;
    this.accumulator = 0;
    this.lastFrameAt = null;
  }

  reset(now = 0) {
    this.accumulator = 0;
    this.lastFrameAt = Number.isFinite(now) ? now : 0;
  }

  advance(now, step) {
    const safeNow = Number.isFinite(now) ? now : (this.lastFrameAt ?? 0);
    if (this.lastFrameAt === null) {
      this.reset(safeNow);
      return { elapsed: 0, steps: 0, alpha: 1, dropped: false };
    }

    const elapsed = clamp((safeNow - this.lastFrameAt) / 1000, 0, this.maximumFrameDelta);
    this.lastFrameAt = safeNow;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.fixedStep && steps < this.maximumSubsteps) {
      step(this.fixedStep);
      this.accumulator -= this.fixedStep;
      steps += 1;
    }

    const dropped = steps === this.maximumSubsteps && this.accumulator >= this.fixedStep;
    if (dropped) this.accumulator %= this.fixedStep;
    if (this.accumulator < 1e-10) this.accumulator = 0;
    return {
      elapsed,
      steps,
      alpha: clamp(this.accumulator / this.fixedStep, 0, 1),
      dropped,
    };
  }
}

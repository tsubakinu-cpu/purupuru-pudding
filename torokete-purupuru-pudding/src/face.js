// The rig owns continuous expression values. Artwork is replaceable per part.
const FACE_EXPRESSIONS = Object.freeze({
  neutral: { open: 0, close: 0, sad: 0, pout: 0 },
  surprised: { open: 0.6, close: 0, sad: 0, pout: 0 },
  eek: { open: 1, close: 0, sad: 0, pout: 0 },
  hmph: { open: 0, close: 0.85, sad: 0, pout: 0.8 },
  sly: { open: 0, close: 0.9, sad: 0, pout: 0 },
  sad: { open: 0, close: 0, sad: 1, pout: 0 },
  cry: { open: 0, close: 0, sad: 1, pout: 0 },
  sleep: { open: 0, close: 1, sad: 0, pout: 0 },
});

export function facePoseFor(expression, surprise = 0, pout = 0) {
  const base = FACE_EXPRESSIONS[expression] ?? FACE_EXPRESSIONS.neutral;
  if (expression === "cry") return { ...base };
  const gestureOpen = Math.max(0, Math.min(1, surprise));
  const gesturePout = Math.max(0, Math.min(1, pout));
  return {
    open: Math.max(base.open, gestureOpen),
    close: Math.max(base.close * (1 - gestureOpen), gesturePout * 0.8),
    sad: base.sad * (1 - gestureOpen),
    pout: Math.max(base.pout * (1 - gestureOpen), gesturePout),
  };
}

export class FaceRig {
  constructor() {
    this.atlas = null;
    this.parts = null;
    this.poses = new WeakMap();
  }

  setAtlas(image, parts) {
    this.atlas = image;
    this.parts = parts;
  }

  poseFor(body, state, now) {
    const desired = {
      ...facePoseFor(state.expression, state.surprise, state.pout),
      gazeX: Math.max(-1, Math.min(1, state.gazeX ?? 0)),
      gazeY: Math.max(-1, Math.min(1, state.gazeY ?? 0)),
    };
    let record = this.poses.get(body);
    if (!record) {
      record = { value: { ...desired }, time: now };
      this.poses.set(body, record);
    }
    const dt = Math.max(0, Math.min(0.05, now - record.time));
    const response = 1 - Math.exp(-dt / 0.07);
    for (const key of Object.keys(desired)) record.value[key] += (desired[key] - record.value[key]) * response;
    record.time = now;
    return record.value;
  }

  drawPart(context, body, rect, x, y, width, height, opacity, mapLocalPoint, rotation = 0) {
    if (!rect || opacity < 0.003) return;
    const [sx, sy, sw, sh] = rect.rect ?? rect;
    const [anchorX, anchorY] = rect.anchor ?? [0.5, 0.5];
    const center = mapLocalPoint(body, x, y);
    const right = mapLocalPoint(body, x + width * 0.5 * Math.cos(rotation), y + width * 0.5 * Math.sin(rotation));
    const bottom = mapLocalPoint(body, x - height * 0.5 * Math.sin(rotation), y + height * 0.5 * Math.cos(rotation));
    context.save();
    context.globalAlpha *= opacity;
    context.transform(
      (right.x - center.x) * 2 / sw, (right.y - center.y) * 2 / sw,
      (bottom.x - center.x) * 2 / sh, (bottom.y - center.y) * 2 / sh,
      center.x, center.y,
    );
    context.drawImage(this.atlas, sx, sy, sw, sh, -sw * anchorX, -sh * anchorY, sw, sh);
    context.restore();
  }

  draw(context, body, pose, mapLocalPoint) {
    if (!this.atlas || !this.parts) return false;
    // One opaque image per feature: openness/size/angle animate geometrically.
    // Closed eyes replace a vertically squashed open eye at the blink midpoint.
    // Never cross-fade unrelated contours or stack two mouths on one another.
    const visiblePout = 1 - Math.pow(1 - pose.pout, 2.4);
    const open = pose.open * (1 - visiblePout * 0.75);
    const closed = Math.max(pose.close, visiblePout * 0.8) * (1 - open);
    const tears = pose.sad * (1 - open) * (1 - pose.close);
    for (const [side, x] of [["left", -0.115], ["right", 0.115]]) {
      const eye = this.parts.eyes;
      const eyeRect = closed > 0.57 ? eye.closed[side]
        : tears > 0.55 ? eye.tears[side]
          : open > 0.62 ? eye.wide[side] : eye.normal[side];
      const eyeHeight = closed > 0.57 ? 0.025 + (closed - 0.57) * 0.045
        : open > 0.62 ? 0.15 + open * 0.025
          : Math.max(0.018, (0.12 + open * 0.035 + tears * 0.016) * (1 - closed * 1.6));
      const gazeAmount = closed > 0.25 || tears > 0.25 ? 0 : 1;
      const eyeX = x + (pose.gazeX ?? 0) * 0.018 * gazeAmount;
      const eyeY = 0.055 + (pose.gazeY ?? 0) * 0.012 * gazeAmount;
      this.drawPart(context, body, eyeRect, eyeX, eyeY,
        (open > 0.62 ? 0.078 : 0.087) + open * 0.018 + closed * 0.012,
        eyeHeight, 1, mapLocalPoint);
      const browAmount = Math.max(open * 0.8, pose.sad, visiblePout);
      if (browAmount > 0.03) {
        const sideSign = side === "left" ? 1 : -1;
        this.drawPart(context, body, this.parts.brows.normal[side], x, -0.04 - open * 0.017,
          0.095, 0.035 * Math.min(1, browAmount * 2.5), 1, mapLocalPoint,
          sideSign * (visiblePout * 0.24 - pose.sad * 0.23));
      }
    }
    const mouth = this.parts.mouths;
    const mouthPout = visiblePout * (1 - open);
    const mouthSad = pose.sad * (1 - open) * (1 - pose.pout);
    if (open > 0.22) {
      this.drawPart(context, body, mouth.open, 0, 0.155,
        0.035 + open * 0.045, 0.018 + Math.max(0,open-0.22)/0.78*0.15, 1, mapLocalPoint);
    } else if (mouthPout > 0.32) {
      this.drawPart(context, body, mouth.pout, 0, 0.16,
        0.085 + mouthPout*0.01, 0.018 + mouthPout*0.027, 1, mapLocalPoint);
    } else if (mouthSad > 0.4) {
      this.drawPart(context, body, mouth.worry, 0, 0.16,
        0.11 + mouthSad*0.02, 0.02 + mouthSad*0.025, 1, mapLocalPoint);
    } else {
      this.drawPart(context, body, mouth.smile, 0, 0.155,
        0.105 - open*0.06, Math.max(0.018,0.068*(1-open/0.3-mouthPout*1.3)), 1, mapLocalPoint);
    }
    return true;
  }
}

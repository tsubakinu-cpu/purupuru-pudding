import { PUDDING_SPRITE } from "./assets.js";
import { REST_RING } from "./physics.js?v=20261006-goals2";
import { FaceRig } from "./face.js";
import { PUDDING_COLORS } from "./merge-world.js?v=20261006-goals2";

const PLACEHOLDER_COLORS = [
  ["#ffe69b", "#e8a866", "#8a4d32"],
  ["#ffe9ad", "#dca66f", "#804631"],
  ["#ffdfa0", "#eead71", "#914f36"],
  ["#ffeab8", "#d99a66", "#7c4936"],
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexRgb(value) {
  const hex = value.replace("#", "");
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function interpolatePoint(point, alpha, target = { x: 0, y: 0 }) {
  const previousX = Number.isFinite(point.renderX) ? point.renderX : point.x;
  const previousY = Number.isFinite(point.renderY) ? point.renderY : point.y;
  target.x = previousX + (point.x - previousX) * alpha;
  target.y = previousY + (point.y - previousY) * alpha;
  return target;
}

function expandedTriangle(points, amount = 1.15) {
  const center = {
    x: (points[0].x + points[1].x + points[2].x) / 3,
    y: (points[0].y + points[1].y + points[2].y) / 3,
  };
  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    return { x: point.x + dx / length * amount, y: point.y + dy / length * amount };
  });
}

function affineForTriangle(source, destination) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const determinant = s0.x * (s1.y - s2.y)
    + s1.x * (s2.y - s0.y)
    + s2.x * (s0.y - s1.y);
  if (Math.abs(determinant) < 1e-8) return null;

  const solve = (v0, v1, v2) => ({
    x: (v0 * (s1.y - s2.y) + v1 * (s2.y - s0.y) + v2 * (s0.y - s1.y)) / determinant,
    y: (v0 * (s2.x - s1.x) + v1 * (s0.x - s2.x) + v2 * (s1.x - s0.x)) / determinant,
    offset: (
      v0 * (s1.x * s2.y - s2.x * s1.y)
      + v1 * (s2.x * s0.y - s0.x * s2.y)
      + v2 * (s0.x * s1.y - s1.x * s0.y)
    ) / determinant,
  });
  const horizontal = solve(d0.x, d1.x, d2.x);
  const vertical = solve(d0.y, d1.y, d2.y);
  return {
    a: horizontal.x,
    b: vertical.x,
    c: horizontal.y,
    d: vertical.y,
    e: horizontal.offset,
    f: vertical.offset,
  };
}

function barycentric(point, a, b, c) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-8) return null;
  const wa = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
  const wb = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
  const wc = 1 - wa - wb;
  return { wa, wb, wc };
}

function mapLocalPoint(body, x, y) {
  const restCenter = { x: 0, y: 0 };
  const dynamicCenter = body.particles[0];
  for (let index = 0; index < REST_RING.length; index += 1) {
    const next = (index + 1) % REST_RING.length;
    const weights = barycentric({ x, y }, restCenter, REST_RING[index], REST_RING[next]);
    if (!weights || weights.wa < -0.001 || weights.wb < -0.001 || weights.wc < -0.001) continue;
    const dynamicA = body.particles[index + 1];
    const dynamicB = body.particles[next + 1];
    return {
      x: dynamicCenter.x * weights.wa + dynamicA.x * weights.wb + dynamicB.x * weights.wc,
      y: dynamicCenter.y * weights.wa + dynamicA.y * weights.wb + dynamicB.y * weights.wc,
    };
  }
  return { x: dynamicCenter.x + x * body.width, y: dynamicCenter.y + y * body.height };
}

function pathBody(context, body) {
  context.beginPath();
  const first = body.particles[1];
  context.moveTo(first.x, first.y);
  for (let index = 2; index < body.particles.length; index += 1) {
    context.lineTo(body.particles[index].x, body.particles[index].y);
  }
  context.closePath();
}

function bodyFrame(body) {
  const center = body.particles[0];
  const right = body.particles[5];
  const left = body.particles[11];
  const top = body.particles[2];
  const bottom = body.particles[8];
  return {
    center,
    axisX: {
      x: (right.x - left.x) / 0.96,
      y: (right.y - left.y) / 0.96,
    },
    axisY: {
      x: (bottom.x - top.x) / 1.03,
      y: (bottom.y - top.y) / 1.03,
    },
  };
}

function framePoint(frame, local) {
  return {
    x: frame.center.x + frame.axisX.x * local.x + frame.axisY.x * local.y,
    y: frame.center.y + frame.axisX.y * local.x + frame.axisY.y * local.y,
  };
}

// Periodic quadratic B-spline: C1-continuous and inside its control-point hull.
// Unlike an overshooting Catmull-Rom curve, it cannot dip under a flat floor.
function smoothRing(points, samplesPerCorner = 3) {
  const samples = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index], next = points[(index + 1) % points.length];
    for (let sample = 0; sample < samplesPerCorner; sample += 1) {
      const t = sample / samplesPerCorner;
      const a = 0.5 * (1 - t) * (1 - t);
      const b = 0.5 + t - t * t;
      const c = 0.5 * t * t;
      samples.push({ x: previous.x * a + current.x * b + next.x * c,
        y: previous.y * a + current.y * b + next.y * c });
    }
  }
  return samples;
}

const SMOOTH_REST_RING = smoothRing(REST_RING);

// Shared-edge pixels are written once into one bitmap, never alpha-composited
// triangle by triangle. This avoids both AA seams and overlap/UV bleed stripes.
function rasterizeTriangle(source, destination, output, texture) {
  const [a,b,c] = destination, [sa,sb,sc] = source;
  const denominator = (b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
  if (Math.abs(denominator) < 1e-8) return;
  const minX = Math.max(0,Math.floor(Math.min(a.x,b.x,c.x)));
  const maxX = Math.min(output.width-1,Math.ceil(Math.max(a.x,b.x,c.x)));
  const minY = Math.max(0,Math.floor(Math.min(a.y,b.y,c.y)));
  const maxY = Math.min(output.height-1,Math.ceil(Math.max(a.y,b.y,c.y)));
  const dw0 = (b.y-c.y)/denominator, dw1 = (c.y-a.y)/denominator;
  for(let y=minY;y<=maxY;y++) {
    const py=y+0.5,px=minX+0.5;
    let w0=((b.y-c.y)*(px-c.x)+(c.x-b.x)*(py-c.y))/denominator;
    let w1=((c.y-a.y)*(px-c.x)+(a.x-c.x)*(py-c.y))/denominator;
    for(let x=minX;x<=maxX;x++,w0+=dw0,w1+=dw1) {
      const w2=1-w0-w1;
      if(w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
      const u=clamp(w0*sa.x+w1*sb.x+w2*sc.x,0,texture.width-1.001);
      const v=clamp(w0*sa.y+w1*sb.y+w2*sc.y,0,texture.height-1.001);
      const ix=Math.floor(u),iy=Math.floor(v),tx=u-ix,ty=v-iy;
      const i=(iy*texture.width+ix)*4,j=i+texture.width*4;
      const data=texture.data;
      const a=(1-tx)*(1-ty)*data[i+3],b=tx*(1-ty)*data[i+7];
      const c=(1-tx)*ty*data[j+3],d=tx*ty*data[j+7];
      const alpha=a+b+c+d;
      if(alpha<0.5) continue;
      const out=(y*output.width+x)*4;
      for(let channel=0;channel<3;channel++) {
        output.data[out+channel]=(a*data[i+channel]+b*data[i+4+channel]+c*data[j+channel]+d*data[j+4+channel])/alpha;
      }
      output.data[out+3]=alpha;
    }
  }
}

function drawLine(context, a, b) {
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
}

export class PuddingRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.sprite = null;
    this.spriteAsset = PUDDING_SPRITE;
    this.debug = options.debug ?? false;
    this.lowPower = options.lowPower ?? false;
    this.bodyViews = new WeakMap();
    this.faceRig = new FaceRig();
    this.texture = null;
    this.spriteVariants = new Map();
    this.textureVariants = new Map();
    this.meshSurfaces = new WeakMap();
  }

  setSprite(result) {
    this.sprite = result?.image ?? null;
    this.spriteAsset = result?.asset ?? PUDDING_SPRITE;
    if (this.sprite && typeof document !== "undefined") {
      this.prepareSpriteVariants();
    }
  }

  prepareSpriteVariants() {
    this.spriteVariants.clear();
    this.textureVariants.clear();
    const width = this.sprite.naturalWidth;
    const height = this.sprite.naturalHeight;
    for (let colorIndex = 0; colorIndex < PUDDING_COLORS.length; colorIndex += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const painter = canvas.getContext("2d", { willReadFrequently: true });
      painter.drawImage(this.sprite, 0, 0);
      if (colorIndex > 0) {
        const pixels = painter.getImageData(0, 0, width, height);
        const target = hexRgb(PUDDING_COLORS[colorIndex].tint);
        const targetLuma = target.r * 0.299 + target.g * 0.587 + target.b * 0.114;
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          if (pixels.data[offset + 3] === 0) continue;
          const pixelIndex = offset / 4;
          const y = Math.floor(pixelIndex / width);
          const r = pixels.data[offset];
          const g = pixels.data[offset + 1];
          const b = pixels.data[offset + 2];
          const luma = r * 0.299 + g * 0.587 + b * 0.114;
          // Keep the dark caramel cap and its drips brown; recolour the custard
          // body while retaining all original gloss and soft shadow detail.
          if (y < height * 0.47 && luma < 138) continue;
          const scale = clamp(luma / targetLuma, 0.42, 1.42);
          const highlight = clamp((luma - 210) / 45, 0, 1);
          const mix = 0.74 * (1 - highlight * 0.42);
          pixels.data[offset] = r * (1 - mix) + clamp(target.r * scale, 0, 255) * mix;
          pixels.data[offset + 1] = g * (1 - mix) + clamp(target.g * scale, 0, 255) * mix;
          pixels.data[offset + 2] = b * (1 - mix) + clamp(target.b * scale, 0, 255) * mix;
        }
        painter.putImageData(pixels, 0, 0);
      }
      this.spriteVariants.set(colorIndex, canvas);
      const textureCanvas = document.createElement("canvas");
      textureCanvas.width = textureCanvas.height = 256;
      const texturePainter = textureCanvas.getContext("2d", { willReadFrequently: true });
      texturePainter.imageSmoothingQuality = "high";
      texturePainter.drawImage(canvas, 0, 0, 256, 256);
      this.textureVariants.set(colorIndex, texturePainter.getImageData(0, 0, 256, 256));
    }
    this.texture = this.textureVariants.get(0) ?? null;
  }

  spriteFor(body) {
    return this.spriteVariants.get(body.colorIndex ?? 0) ?? this.sprite;
  }

  textureFor(body) {
    return this.textureVariants.get(body.colorIndex ?? 0) ?? this.texture;
  }

  setFaceParts(image, parts) {
    this.faceRig.setAtlas(image, parts);
  }

  resize(width, height, bodyCount = 0) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    const deviceScale = globalThis.devicePixelRatio || 1;
    const cap = this.lowPower || bodyCount >= 6 ? 1.35 : bodyCount >= 4 ? 1.55 : 1.8;
    this.dpr = clamp(deviceScale, 1, cap);
    const pixelWidth = Math.max(1, Math.round(this.width * this.dpr));
    const pixelHeight = Math.max(1, Math.round(this.height * this.dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  displayBody(body, interpolationAlpha) {
    let record = this.bodyViews.get(body);
    if (!record) {
      const particles = body.particles.map((point) => ({ x: point.x, y: point.y }));
      const view = Object.create(body);
      Object.defineProperty(view, "particles", { value: particles });
      record = { view, particles };
      this.bodyViews.set(body, record);
    }
    const alpha = body.dragPointer === null ? interpolationAlpha : 1;
    for (let index = 0; index < body.particles.length; index += 1) {
      interpolatePoint(body.particles[index], alpha, record.particles[index]);
    }
    return record.view;
  }

  render(world, interpolationAlpha = 1) {
    const context = this.context;
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop(world);

    const alpha = clamp(interpolationAlpha, 0, 1);
    const renderTime = Math.max(0, world.time - (1 - alpha) / 60);
    const bodies = world.bodies
      .map((body) => this.displayBody(body, alpha))
      .sort((a, b) => (a.renderOrder ?? a.createdAt) - (b.renderOrder ?? b.createdAt));
    for (const body of bodies) this.drawShadow(body, world.floorY);
    this.drawFusionBridges(world);
    // Physical vertices (including the fan center) are floor-constrained.
    // Also contain texture-filter/triangle-overlap pixels, not the floor shadow.
    context.save();
    context.beginPath();
    context.rect(0, 0, this.width, world.floorY);
    context.clip();
    for (const body of bodies) {
      const source = Object.getPrototypeOf(body);
      const scale = this.effectScale(source, renderTime);
      context.save();
      if (Math.abs(scale - 1) > 0.001) {
        const center = body.particles[0];
        context.translate(center.x, center.y);
        context.scale(scale, scale);
        context.translate(-center.x, -center.y);
      }
      if (this.sprite && !this.shouldUseMesh(body) && !this.debug) this.drawAffineSprite(body);
      else if (this.sprite) this.drawSpriteMesh(body);
      else this.drawVerificationShape(body);
      this.drawDecoration(body, renderTime);
      this.drawCheeks(body, renderTime);
      const state = world.faceStateFor(source);
      const gestureSurprise = source.renderGestureSurprise
        + (source.gestureSurprise - source.renderGestureSurprise) * alpha;
      const gesturePout = source.renderGesturePout + (source.gesturePout - source.renderGesturePout) * alpha;
      state.surprise = Math.max(state.surprise ?? 0, gestureSurprise);
      state.pout = Math.max(state.pout ?? 0, gesturePout);
      const pose = this.faceRig.poseFor(source, state, renderTime);
      if (!this.faceRig.draw(context, body, pose, mapLocalPoint)) {
        this.drawFace(body, state.expression, pose);
      }
      this.drawIdleMarks(body);
      if (this.debug) this.drawMesh(body);
      context.restore();
    }
    this.drawGoalCollection(world, renderTime);
    context.restore();
    this.drawSparkles(world);
  }

  effectScale(body, time) {
    const mergeAge = time - (body.mergeBirthAt ?? -Infinity);
    if (mergeAge >= 0 && mergeAge < 0.62) {
      return 1 - 0.2 * Math.exp(-mergeAge * 5.2) * Math.cos(mergeAge * 22);
    }
    const splitAge = time - (body.splitBirthAt ?? -Infinity);
    if (splitAge >= 0 && splitAge < 0.42) {
      return 1 + 0.08 * Math.exp(-splitAge * 7) * Math.sin(splitAge * 25);
    }
    return 1;
  }

  drawFusionBridges(world) {
    const context = this.context;
    for (const [key, state] of world.fusionPairs ?? []) {
      if (state.progress < 0.035) continue;
      const [aId, bId] = key.split(":").map(Number);
      const a = world.getBody(aId);
      const b = world.getBody(bId);
      if (!a || !b) continue;
      const start = a.particles[0];
      const end = b.particles[0];
      const progress = state.progress * state.progress * (3 - 2 * state.progress);
      context.save();
      context.lineCap = "round";
      context.globalAlpha = 0.18 + progress * 0.58;
      context.strokeStyle = PUDDING_COLORS[a.colorIndex]?.tint ?? "#ffd768";
      context.lineWidth = Math.min(a.height, b.height) * (0.08 + progress * 0.2);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      context.globalAlpha *= 0.66;
      context.strokeStyle = PUDDING_COLORS[a.colorIndex]?.accent ?? "#fff2a6";
      context.lineWidth *= 0.24;
      context.stroke();
      context.restore();
    }
  }

  drawSparkles(world) {
    const context = this.context;
    for (const sparkle of world.sparkles ?? []) {
      const progress = clamp(sparkle.age / sparkle.duration, 0, 1);
      const size = sparkle.size * (1 - progress * 0.62);
      context.save();
      context.translate(sparkle.x, sparkle.y);
      context.rotate(sparkle.spin + sparkle.age * 8);
      const twinkleAge = sparkle.age - (sparkle.twinkleDelay ?? 0);
      const twinkle = twinkleAge <= 0 ? 0.72
        : 0.58 + Math.abs(Math.sin(twinkleAge * (sparkle.twinkleRate ?? 16))) * 0.42;
      context.globalAlpha = Math.pow(1 - progress, 0.65) * twinkle;
      context.fillStyle = sparkle.color;
      context.beginPath();
      context.moveTo(0, -size * 1.6);
      context.lineTo(size * 0.55, -size * 0.45);
      context.lineTo(size * 1.5, 0);
      context.lineTo(size * 0.55, size * 0.45);
      context.lineTo(0, size * 1.6);
      context.lineTo(-size * 0.55, size * 0.45);
      context.lineTo(-size * 1.5, 0);
      context.lineTo(-size * 0.55, -size * 0.45);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  drawGoalCollection(world, renderTime = world.time) {
    for (const collection of world.goalCollections ?? []) this.drawGoalFlight(world, collection, renderTime);
  }

  drawGoalFlight(world, collection, renderTime = world.time) {
    const body = collection.body;
    const center = body.particles[0];
    const progress = clamp((renderTime - collection.startedAt) / collection.duration, 0, 1);
    const travel = 1 - Math.pow(1 - progress, 3);
    const shrink = Math.max(0.025, 1 - Math.pow(progress, 1.35));
    const target = world.goalAnchor ?? { x: this.width - 62, y: 58 };
    const x = center.x + (target.x - center.x) * travel;
    const y = center.y + (target.y - center.y) * travel;
    const context = this.context;
    context.save();
    context.translate(x, y);
    context.rotate(collection.turn * progress * Math.PI * 3.4);
    context.scale(shrink, shrink);
    context.translate(-center.x, -center.y);
    if (this.sprite && !this.shouldUseMesh(body) && !this.debug) this.drawAffineSprite(body);
    else if (this.sprite) this.drawSpriteMesh(body);
    else this.drawVerificationShape(body);
    this.drawDecoration(body, renderTime);
    this.drawCheeks(body, renderTime);
    const state = { expression: "eek", surprise: 1, pout: 0, gazeX: 0, gazeY: -0.2 };
    const pose = this.faceRig.poseFor(body, state, renderTime);
    if (!this.faceRig.draw(context, body, pose, mapLocalPoint)) this.drawFace(body, "eek", pose);
    context.restore();
  }

  drawBackdrop(world) {
    const context = this.context;
    const sky = context.createLinearGradient(0, 0, 0, this.height);
    sky.addColorStop(0, "#fffaf0");
    sky.addColorStop(0.62, "#fff0d7");
    sky.addColorStop(1, "#efc39f");
    context.fillStyle = sky;
    context.fillRect(0, 0, this.width, this.height);

    const glow = context.createRadialGradient(
      this.width * 0.5,
      this.height * 0.34,
      8,
      this.width * 0.5,
      this.height * 0.34,
      Math.max(this.width, this.height) * 0.52,
    );
    glow.addColorStop(0, "rgba(255,255,255,.82)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, this.width, world.floorY);

    context.fillStyle = "rgba(134, 79, 55, .08)";
    context.fillRect(0, world.floorY, this.width, Math.max(0, this.height - world.floorY));
    context.strokeStyle = "rgba(122, 73, 47, .14)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, world.floorY + 0.5);
    context.lineTo(this.width, world.floorY + 0.5);
    context.stroke();
  }

  drawShadow(body, floorY) {
    const context = this.context;
    const center = body.particles[0];
    const distanceToFloor = Math.max(0, floorY - center.y);
    const proximity = clamp(1 - distanceToFloor / 350, 0.08, 1);
    const bottom = Math.max(...body.particles.slice(1).map((point) => point.y));
    const shadowY = Math.min(floorY + 3, bottom + 8);
    context.save();
    context.globalAlpha = 0.15 * proximity;
    context.fillStyle = "#70432f";
    context.beginPath();
    context.ellipse(center.x, shadowY, body.width * (0.22 + proximity * 0.18), 5 + proximity * 5, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  sourceMesh() {
    const bounds = this.spriteAsset.alphaBounds;
    const sourceCenter = {
      x: bounds.left + (bounds.right - bounds.left) * 0.5,
      y: bounds.top + (bounds.bottom - bounds.top) * (0.52 / 1.03),
    };
    const horizontalScale = (bounds.right - bounds.left) / 1.04;
    const verticalScale = (bounds.bottom - bounds.top) / 1.03;
    return {
      center: sourceCenter,
      ring: REST_RING.map((point) => ({
        x: sourceCenter.x + point.x * horizontalScale,
        y: sourceCenter.y + point.y * verticalScale,
      })),
    };
  }

  deformationMetric(body) {
    const frame = bodyFrame(body);
    let maximum = 0;
    for (let index = 0; index < REST_RING.length; index += 1) {
      const expected = framePoint(frame, REST_RING[index]);
      const actual = body.particles[index + 1];
      maximum = Math.max(maximum, Math.hypot(expected.x - actual.x, expected.y - actual.y));
    }
    return maximum;
  }

  shouldUseMesh(body) {
    this.spriteModes ??= new WeakMap();
    const metric = this.deformationMetric(body);
    const wasMesh = this.spriteModes.get(body) ?? false;
    // A 2.15px threshold used to alternate two visibly different outlines.
    // Keep any switch subpixel and give it hysteresis instead of flickering.
    const useMesh = metric > (wasMesh ? 0.35 : 0.85);
    this.spriteModes.set(body, useMesh);
    return useMesh;
  }

  drawAffineSprite(body) {
    const context = this.context;
    const sprite = this.spriteFor(body);
    const source = this.sourceMesh();
    const bounds = this.spriteAsset.alphaBounds;
    const horizontalScale = (bounds.right - bounds.left) / 1.04;
    const verticalScale = (bounds.bottom - bounds.top) / 1.03;
    const frame = bodyFrame(body);
    const a = frame.axisX.x / horizontalScale;
    const b = frame.axisX.y / horizontalScale;
    const c = frame.axisY.x / verticalScale;
    const d = frame.axisY.y / verticalScale;
    const e = frame.center.x - a * source.center.x - c * source.center.y;
    const f = frame.center.y - b * source.center.x - d * source.center.y;
    context.save();
    context.transform(a, b, c, d, e, f);
    context.drawImage(sprite, 0, 0);
    context.restore();
  }

  drawSpriteMesh(body) {
    const context = this.context;
    const sprite = this.spriteFor(body);
    const texture = this.textureFor(body);
    const source = this.sourceMesh();
    const sourceRing = smoothRing(source.ring);
    const destinationRing = smoothRing(body.particles.slice(1));
    const frame = bodyFrame(body);
    this.meshStats ??= { rasterizations: 0, cacheHits: 0 };
    let surface = null;
    if (texture) {
      const xs=destinationRing.map(p=>p.x),ys=destinationRing.map(p=>p.y);
      const left=Math.min(...xs)-2,top=Math.min(...ys)-2;
      const width=Math.max(...xs)-left+2,height=Math.max(...ys)-top+2;
      const scale=Math.min(this.dpr,1.25,320/Math.max(width,height));
      const pixelWidth=Math.ceil(width*scale),pixelHeight=Math.ceil(height*scale);
      surface=this.meshSurfaces.get(body);
      const determinant=frame.axisX.x*frame.axisY.y-frame.axisX.y*frame.axisY.x;
      const geometry=destinationRing.map(p=>{
        const dx=p.x-frame.center.x,dy=p.y-frame.center.y;
        return {x:(dx*frame.axisY.y-dy*frame.axisY.x)/determinant,
          y:(frame.axisX.x*dy-frame.axisX.y*dx)/determinant};
      });
      const materialScale=Math.max(Math.hypot(frame.axisX.x,frame.axisX.y),Math.hypot(frame.axisY.x,frame.axisY.y));
      const reusable=surface?.geometry && surface.scale===scale
        && geometry.every((p,i)=>Math.hypot(p.x-surface.geometry[i].x,p.y-surface.geometry[i].y)*materialScale<0.3);
      if(reusable) {
        const triangle=f=>[f.center,{x:f.center.x+f.axisX.x,y:f.center.y+f.axisX.y},
          {x:f.center.x+f.axisY.x,y:f.center.y+f.axisY.y}];
        const transport=affineForTriangle(triangle(surface.frame),triangle(frame));
        if(transport) {
          this.meshStats.cacheHits+=1;
          context.save();
          context.transform(transport.a,transport.b,transport.c,transport.d,transport.e,transport.f);
          context.drawImage(surface.canvas,surface.left,surface.top,surface.canvas.width/scale,surface.canvas.height/scale);
          context.restore();
          return;
        }
      }
      if(!surface || surface.canvas.width<pixelWidth || surface.canvas.height<pixelHeight) {
        const canvas=document.createElement("canvas");
        canvas.width=Math.ceil(pixelWidth/16)*16;canvas.height=Math.ceil(pixelHeight/16)*16;
        const painter=canvas.getContext("2d");
        surface={canvas,painter,pixels:painter.createImageData(canvas.width,canvas.height)};
        this.meshSurfaces.set(body,surface);
      }
      this.meshStats.rasterizations += 1;
      Object.assign(surface,{left,top,scale,geometry,
        frame:{center:{...frame.center},axisX:{...frame.axisX},axisY:{...frame.axisY}}});
      surface.pixels.data.fill(0);
    }
    const pointAt = (index, radius, isSource) => {
      if (isSource) return {
        x: source.center.x + (sourceRing[index].x - source.center.x) * radius,
        y: source.center.y + (sourceRing[index].y - source.center.y) * radius,
      };
      const affine = framePoint(frame, SMOOTH_REST_RING[index]);
      const blend = radius * radius * (3 - 2 * radius);
      return {
        x: frame.center.x + (affine.x - frame.center.x) * radius
          + (destinationRing[index].x - affine.x) * blend,
        y: frame.center.y + (affine.y - frame.center.y) * radius
          + (destinationRing[index].y - affine.y) * blend,
      };
    };
    const drawTriangle = (sourceTriangle, destinationTriangle) => {
      if (surface) {
        const sourceScale=texture.width/sprite.width;
        rasterizeTriangle(sourceTriangle.map(p=>({x:p.x*sourceScale,y:p.y*sourceScale})),
          destinationTriangle.map(p=>({x:(p.x-surface.left)*surface.scale,y:(p.y-surface.top)*surface.scale})),
          surface.pixels,texture);
        return;
      }
      const transform = affineForTriangle(sourceTriangle, destinationTriangle);
      if (!transform) return;
      const clipPoints = expandedTriangle(destinationTriangle, 0.22);
      context.save();
      context.beginPath();
      context.moveTo(clipPoints[0].x, clipPoints[0].y);
      context.lineTo(clipPoints[1].x, clipPoints[1].y);
      context.lineTo(clipPoints[2].x, clipPoints[2].y);
      context.closePath();
      context.clip();
      context.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
      context.drawImage(sprite, 0, 0);
      context.restore();
    };
    context.save();
    context.beginPath();
    const ring = body.particles.slice(1);
    context.moveTo((ring.at(-1).x + ring[0].x) * 0.5, (ring.at(-1).y + ring[0].y) * 0.5);
    for (let index = 0; index < ring.length; index += 1) {
      const p = ring[index], next = ring[(index + 1) % ring.length];
      context.quadraticCurveTo(p.x, p.y, (p.x + next.x) * 0.5, (p.y + next.y) * 0.5);
    }
    context.closePath();
    context.clip();
    for (let index = 0; index < sourceRing.length; index += 1) {
      const next = (index + 1) % sourceRing.length;
      const innerSource = pointAt(index, 0.45, true), nextInnerSource = pointAt(next, 0.45, true);
      const innerDestination = pointAt(index, 0.45, false), nextInnerDestination = pointAt(next, 0.45, false);
      drawTriangle([source.center, innerSource, nextInnerSource],
        [frame.center, innerDestination, nextInnerDestination]);
      drawTriangle([innerSource, pointAt(index, 1, true), pointAt(next, 1, true)],
        [innerDestination, pointAt(index, 1, false), pointAt(next, 1, false)]);
      drawTriangle([innerSource, pointAt(next, 1, true), nextInnerSource],
        [innerDestination, pointAt(next, 1, false), nextInnerDestination]);
    }
    if(surface) {
      surface.painter.putImageData(surface.pixels,0,0);
      context.drawImage(surface.canvas,surface.left,surface.top,
        surface.canvas.width/surface.scale,surface.canvas.height/surface.scale);
    }
    context.restore();
  }

  drawVerificationShape(body) {
    const context = this.context;
    const palette = PLACEHOLDER_COLORS[body.variant % PLACEHOLDER_COLORS.length];
    const bounds = body.particles.slice(1).reduce((result, point) => ({
      minY: Math.min(result.minY, point.y),
      maxY: Math.max(result.maxY, point.y),
    }), { minY: Infinity, maxY: -Infinity });
    const fill = context.createLinearGradient(0, bounds.minY, 0, bounds.maxY);
    fill.addColorStop(0, palette[0]);
    fill.addColorStop(1, palette[1]);
    context.save();
    pathBody(context, body);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = "rgba(114, 65, 43, .32)";
    context.lineWidth = 1.5;
    context.stroke();

    const topLeft = mapLocalPoint(body, -0.29, -0.43);
    const topRight = mapLocalPoint(body, 0.29, -0.43);
    const topMid = mapLocalPoint(body, 0, -0.49);
    const topBottom = mapLocalPoint(body, 0, -0.31);
    context.fillStyle = palette[2];
    context.beginPath();
    context.ellipse(
      (topLeft.x + topRight.x) * 0.5,
      (topMid.y + topBottom.y) * 0.5,
      Math.max(8, Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) * 0.52),
      Math.max(4, Math.hypot(topBottom.x - topMid.x, topBottom.y - topMid.y) * 0.52),
      Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x),
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
  }

  drawDecoration(body, time = Infinity) {
    if (!body.tier) return;
    const context = this.context;
    const frame = bodyFrame(body);
    context.save();
    context.transform(
      frame.axisX.x,
      frame.axisX.y,
      frame.axisY.x,
      frame.axisY.y,
      frame.center.x,
      frame.center.y,
    );
    const mergeAge = time - (body.mergeBirthAt ?? -Infinity);
    const decorationPop = mergeAge >= 0 && mergeAge < 0.48
      ? 1 - 0.82 * Math.exp(-mergeAge * 8.5) * Math.cos(mergeAge * 22)
      : 1;
    const landingAge = time - (body.lastImpactAt ?? -Infinity) - 0.08;
    const delayedWobble = landingAge >= 0 && landingAge < 0.72
      ? Math.sin(landingAge * 24) * Math.exp(-landingAge * 5.2)
      : 0;
    context.translate(0, -0.51);
    context.rotate(delayedWobble * 0.08);
    context.scale(
      Math.max(0.12, decorationPop) * (1 + delayedWobble * 0.055),
      Math.max(0.12, decorationPop) * (1 - delayedWobble * 0.04),
    );
    context.translate(0, 0.51);
    context.fillStyle = "#fff8e9";
    context.strokeStyle = "rgba(116, 67, 48, .24)";
    context.lineWidth = 0.012;
    for (const lobe of [
      { x: -0.105, y: -0.49, rx: 0.13, ry: 0.08 },
      { x: 0.105, y: -0.49, rx: 0.13, ry: 0.08 },
      { x: 0, y: -0.55, rx: 0.15, ry: 0.11 },
    ]) {
      context.beginPath();
      context.ellipse(lobe.x, lobe.y, lobe.rx, lobe.ry, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.fillStyle = "rgba(255,255,255,.75)";
    context.beginPath();
    context.ellipse(-0.045, -0.585, 0.04, 0.018, -0.25, 0, Math.PI * 2);
    context.fill();
    if (body.tier >= 2) {
      context.strokeStyle = "#547342";
      context.lineWidth = 0.018;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(0.035, -0.655);
      context.quadraticCurveTo(0.11, -0.76, 0.17, -0.7);
      context.stroke();
      context.fillStyle = "#d94a52";
      context.strokeStyle = "#9d3040";
      context.lineWidth = 0.01;
      context.beginPath();
      context.arc(0, -0.65, 0.09, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "rgba(255,255,255,.78)";
      context.beginPath();
      context.ellipse(-0.03, -0.68, 0.022, 0.014, -0.6, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  drawCheeks(body, time = Infinity) {
    const frame = bodyFrame(body);
    const landingAge = time - (body.lastImpactAt ?? -Infinity) - 0.11;
    const wobble = landingAge >= 0 && landingAge < 0.68
      ? Math.sin(landingAge * 23) * Math.exp(-landingAge * 5.5)
      : 0;
    const context = this.context;
    context.save();
    context.transform(
      frame.axisX.x,
      frame.axisX.y,
      frame.axisY.x,
      frame.axisY.y,
      frame.center.x,
      frame.center.y,
    );
    context.globalAlpha = 0.2 + Math.abs(wobble) * 0.12;
    context.fillStyle = "#ef8f94";
    for (const x of [-0.22, 0.22]) {
      context.beginPath();
      context.ellipse(x, 0.15 + wobble * 0.012, 0.055 * (1 + Math.abs(wobble) * 0.18), 0.024, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  drawIdleMarks(body) {
    if (body.idleState !== "sleep") return;
    const context = this.context;
    const anchor = mapLocalPoint(body, 0.3, -0.28);
    const scale = clamp(body.width / 100, 0.72, 1.3);
    context.save();
    context.fillStyle = "rgba(91, 57, 45, .72)";
    context.font = `800 ${Math.round(13 * scale)}px ui-rounded, sans-serif`;
    context.textAlign = "center";
    context.fillText("z", anchor.x, anchor.y - 8 * scale);
    context.globalAlpha = 0.72;
    context.font = `800 ${Math.round(10 * scale)}px ui-rounded, sans-serif`;
    context.fillText("z", anchor.x + 11 * scale, anchor.y - 19 * scale);
    context.restore();
  }

  drawFace(body, expression, pose = null) {
    if (pose && (pose.open > 0.005 || pose.pout > 0.005)) {
      this.drawGestureFace(body, pose);
      return;
    }
    const context = this.context;
    const leftEye = mapLocalPoint(body, -0.115, 0.055);
    const rightEye = mapLocalPoint(body, 0.115, 0.055);
    const eyeScale = clamp(body.width / 112, 0.7, 1.2);
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#4e3028";
    context.fillStyle = "#4e3028";
    context.lineWidth = 2.5 * eyeScale;

    if (expression === "hmph") {
      drawLine(context, mapLocalPoint(body, -0.15, 0.055), mapLocalPoint(body, -0.075, 0.06));
      drawLine(context, mapLocalPoint(body, 0.075, 0.06), mapLocalPoint(body, 0.15, 0.055));
      const mouthA = mapLocalPoint(body, -0.035, 0.165);
      const mouthB = mapLocalPoint(body, 0.035, 0.165);
      const mouthMid = mapLocalPoint(body, 0, 0.145);
      context.beginPath();
      context.moveTo(mouthA.x, mouthA.y);
      context.quadraticCurveTo(mouthMid.x, mouthMid.y, mouthB.x, mouthB.y);
      context.stroke();
    } else if (expression === "sad") {
      context.beginPath();
      context.arc(leftEye.x, leftEye.y + 1.5 * eyeScale, 2.45 * eyeScale, 0, Math.PI * 2);
      context.arc(rightEye.x, rightEye.y + 1.5 * eyeScale, 2.45 * eyeScale, 0, Math.PI * 2);
      context.fill();
      const mouthA = mapLocalPoint(body, -0.04, 0.175);
      const mouthB = mapLocalPoint(body, 0.04, 0.175);
      const mouthMid = mapLocalPoint(body, 0, 0.145);
      context.beginPath();
      context.moveTo(mouthA.x, mouthA.y);
      context.quadraticCurveTo(mouthMid.x, mouthMid.y, mouthB.x, mouthB.y);
      context.stroke();
    } else if (expression === "eek") {
      context.beginPath();
      context.ellipse(leftEye.x, leftEye.y, 3.2 * eyeScale, 4.5 * eyeScale, 0, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.ellipse(rightEye.x, rightEye.y, 3.2 * eyeScale, 4.5 * eyeScale, 0, 0, Math.PI * 2);
      context.stroke();
      const mouth = mapLocalPoint(body, 0, 0.155);
      context.beginPath();
      context.ellipse(mouth.x, mouth.y, 3.7 * eyeScale, 5.8 * eyeScale, 0, 0, Math.PI * 2);
      context.fill();
    } else if (expression === "sly") {
      drawLine(context, mapLocalPoint(body, -0.15, 0.06), mapLocalPoint(body, -0.075, 0.068));
      drawLine(context, mapLocalPoint(body, 0.075, 0.068), mapLocalPoint(body, 0.15, 0.055));
      context.beginPath();
      const mouthA = mapLocalPoint(body, -0.018, 0.145);
      const mouthB = mapLocalPoint(body, 0.065, 0.125);
      context.moveTo(mouthA.x, mouthA.y);
      context.quadraticCurveTo(
        (mouthA.x + mouthB.x) * 0.5,
        Math.max(mouthA.y, mouthB.y) + 4 * eyeScale,
        mouthB.x,
        mouthB.y,
      );
      context.stroke();
    } else {
      const radius = (expression === "surprised" ? 3.4 : 2.8) * eyeScale;
      context.beginPath();
      context.arc(leftEye.x, leftEye.y, radius, 0, Math.PI * 2);
      context.arc(rightEye.x, rightEye.y, radius, 0, Math.PI * 2);
      context.fill();
      const mouth = mapLocalPoint(body, 0, 0.15);
      context.beginPath();
      if (expression === "surprised") {
        context.ellipse(mouth.x, mouth.y, 2.6 * eyeScale, 3.8 * eyeScale, 0, 0, Math.PI * 2);
        context.stroke();
      } else {
        context.arc(mouth.x, mouth.y - 2, 5 * eyeScale, 0.18 * Math.PI, 0.82 * Math.PI);
        context.stroke();
      }
    }
    context.restore();
  }

  drawGestureFace(body, pose) {
    const context = this.context;
    const scale = clamp(body.width / 112, 0.7, 1.2);
    const open = pose.open * (1 - pose.pout * 0.8);
    context.save();
    context.lineCap = "round";
    context.strokeStyle = context.fillStyle = "#4e3028";
    context.lineWidth = 2.2 * scale;
    for (const x of [-0.115, 0.115]) {
      const eye = mapLocalPoint(body, x, 0.055);
      context.beginPath();
      context.ellipse(eye.x, eye.y, (2.8 + open * 0.65) * scale,
        Math.max(0.65, (2.8 + open * 2.2) * (1 - pose.pout * 0.8)) * scale,
        Math.atan2(bodyFrame(body).axisX.y, bodyFrame(body).axisX.x), 0, Math.PI * 2);
      context.globalAlpha = 1 - open;
      context.fill();
      context.globalAlpha = open;
      context.stroke();
    }
    const mouth = mapLocalPoint(body, 0, 0.155);
    context.globalAlpha = open;
    context.beginPath();
    context.ellipse(mouth.x, mouth.y, (2.1 + open * 1.6) * scale,
      (2 + open * 4.2) * scale, 0, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1 - open;
    const a = mapLocalPoint(body, -0.04, 0.155 + pose.pout * 0.01);
    const b = mapLocalPoint(body, 0.04, 0.155 + pose.pout * 0.01);
    const mid = mapLocalPoint(body, 0, 0.20 - pose.pout * 0.065);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
    context.stroke();
    context.restore();
  }

  drawMesh(body) {
    const context = this.context;
    context.save();
    context.strokeStyle = "rgba(92, 45, 38, .35)";
    context.fillStyle = "rgba(255, 255, 255, .7)";
    context.lineWidth = 0.7;
    for (let index = 0; index < REST_RING.length; index += 1) {
      const next = (index + 1) % REST_RING.length;
      drawLine(context, body.particles[0], body.particles[index + 1]);
      drawLine(context, body.particles[index + 1], body.particles[next + 1]);
    }
    for (const point of body.particles) {
      context.beginPath();
      context.arc(point.x, point.y, 1.8, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

export const rendererMath = Object.freeze({ affineForTriangle, barycentric, mapLocalPoint, interpolatePoint, smoothRing, rasterizeTriangle });

export const REST_RING = Object.freeze([
  Object.freeze({ x: -0.38, y: -0.47 }),
  Object.freeze({ x: 0, y: -0.52 }),
  Object.freeze({ x: 0.38, y: -0.47 }),
  Object.freeze({ x: 0.44, y: -0.27 }),
  Object.freeze({ x: 0.48, y: 0.04 }),
  Object.freeze({ x: 0.52, y: 0.4 }),
  Object.freeze({ x: 0.28, y: 0.49 }),
  Object.freeze({ x: 0, y: 0.51 }),
  Object.freeze({ x: -0.28, y: 0.49 }),
  Object.freeze({ x: -0.52, y: 0.4 }),
  Object.freeze({ x: -0.48, y: 0.04 }),
  Object.freeze({ x: -0.44, y: -0.27 }),
]);

export const DEFAULT_CONFIG = Object.freeze({
  gravity: 1450,
  airDamping: 0.993,
  iterations: 8,
  maxBodies: 7,
  floorInset: 104,
  wallPadding: 5,
  restitution: 0.055,
  floorFriction: 0.82,
  contactSkin: 0.65,
  maxStepVelocity: 34,
});

export const MOTION_TUNING = Object.freeze({
  minimumLandingSpeed: 155,
  highFallSpeed: 300,
  highFallDistanceFactor: 0.78,
  highFallMinimumDistance: 72,
  minimumLandingSteps: 4,
  highFallMinimumSteps: 8,
  landingCooldown: 0.95,
  supportMaximumGap: 4,
  supportMinimumOverlapFactor: 0.28,
  nearbyHorizontalFactor: 0.8,
  nearbyVerticalFactor: 0.72,
});

export const GESTURE_TUNING = Object.freeze({
  inputSpeedLimit: 1600,
  releaseSpeedLimit: 920,
  releaseVelocityScale: 0.52,
  stretchDistanceFactor: 1.18,
  stretchParallelGain: 0.17,
  stretchTrailGain: 0.085,
  poutDelay: 0.22,
  poutDuration: 0.58,
  minimumReactionDistance: 14,
});

const EPSILON = 1e-7;
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep01(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - current.y * next.x;
  }
  return sum * 0.5;
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const a = points[index];
    const b = points[previous];
    const crosses = (a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function makeParticle(x, y, invMass = 1) {
  return {
    x,
    y,
    px: x,
    py: y,
    renderX: x,
    renderY: y,
    invMass,
    baseInvMass: invMass,
    floorStep: -1,
    wallStep: -1,
  };
}

function makeDistanceConstraint(particles, a, b, stiffness) {
  return {
    a,
    b,
    rest: distance(particles[a], particles[b]),
    stiffness,
  };
}

function bodyRing(body) {
  return body.particles.slice(1);
}

function bodyAabb(body) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 1; index < body.particles.length; index += 1) {
    const point = body.particles[index];
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function overlaps(a, b, padding = 0) {
  return a.minX <= b.maxX + padding
    && a.maxX + padding >= b.minX
    && a.minY <= b.maxY + padding
    && a.maxY + padding >= b.minY;
}

function projectPolygon(points, axisX, axisY) {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const projection = point.x * axisX + point.y * axisY;
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return { min, max };
}

function satCollision(bodyA, bodyB, verticalBias = 1, preferredNormal = null) {
  const polygonA = bodyRing(bodyA);
  const polygonB = bodyRing(bodyB);
  let bestOverlap = Infinity;
  let bestAxisX = 0;
  let bestAxisY = 0;
  for (const polygon of [polygonA, polygonB]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const point = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const edgeX = next.x - point.x;
      const edgeY = next.y - point.y;
      const edgeLength = Math.hypot(edgeX, edgeY);
      if (edgeLength < EPSILON) continue;
      const axisX = -edgeY / edgeLength;
      const axisY = edgeX / edgeLength;
      const projectionA = projectPolygon(polygonA, axisX, axisY);
      const projectionB = projectPolygon(polygonB, axisX, axisY);
      const overlap = Math.min(projectionA.max, projectionB.max) - Math.max(projectionA.min, projectionB.min);
      if (overlap <= 0) return null;
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestAxisX = axisX;
        bestAxisY = axisY;
      }
    }
  }

  const centerA = bodyA.particles[0];
  const centerB = bodyB.particles[0];
  const centerDeltaX = centerB.x - centerA.x;
  const centerDeltaY = centerB.y - centerA.y;
  if (Math.abs(centerDeltaY) > Math.abs(centerDeltaX) * 1.45
    && Math.abs(centerDeltaX) < (bodyA.width + bodyB.width) * 0.16 * verticalBias) {
    const verticalA = projectPolygon(polygonA, 0, 1);
    const verticalB = projectPolygon(polygonB, 0, 1);
    const verticalOverlap = Math.min(verticalA.max, verticalB.max) - Math.max(verticalA.min, verticalB.min);
    if (verticalOverlap > 0 && verticalOverlap <= bestOverlap * 1.45) {
      bestOverlap = verticalOverlap;
      bestAxisX = 0;
      bestAxisY = Math.sign(centerDeltaY) || 1;
    }
  }
  if (preferredNormal) {
    const preferredLength = Math.hypot(preferredNormal.nx, preferredNormal.ny);
    if (preferredLength > EPSILON) {
      const hintX = preferredNormal.nx / preferredLength;
      const hintY = preferredNormal.ny / preferredLength;
      const preferredA = projectPolygon(polygonA, hintX, hintY);
      const preferredB = projectPolygon(polygonB, hintX, hintY);
      const preferredOverlap = Math.min(preferredA.max, preferredB.max) - Math.max(preferredA.min, preferredB.min);
      const centerAlongHint = centerDeltaX * hintX + centerDeltaY * hintY;
      const deeplyCrossed = Math.abs(centerAlongHint) < Math.min(bodyA.width, bodyB.width) * 0.24;
      const unrelatedAxis = Math.abs(bestAxisX * hintX + bestAxisY * hintY) < 0.32;
      const nearSameAxis = Math.abs(bestAxisX * hintX + bestAxisY * hintY) > 0.85
        && preferredOverlap <= bestOverlap + 0.65;
      if (preferredOverlap > 0 && (deeplyCrossed || unrelatedAxis || nearSameAxis)) {
        bestOverlap = preferredOverlap;
        bestAxisX = hintX;
        bestAxisY = hintY;
      }
    }
  }
  const centerDot = (centerB.x - centerA.x) * bestAxisX + (centerB.y - centerA.y) * bestAxisY;
  if (preferredNormal) {
    // Once two soft bodies touch, keep the contact normal pointing the same way.
    // This avoids the classic deep-overlap failure where a dragged body crosses
    // the other centre and SAT suddenly pushes it out through the opposite side.
    const preferredDot = preferredNormal.nx * bestAxisX + preferredNormal.ny * bestAxisY;
    if (Math.abs(preferredDot) > 0.32) {
      if (preferredDot < 0) {
        bestAxisX *= -1;
        bestAxisY *= -1;
      }
    } else if (centerDot < 0) {
      bestAxisX *= -1;
      bestAxisY *= -1;
    }
  } else if (centerDot < 0) {
    bestAxisX *= -1;
    bestAxisY *= -1;
  }
  return { overlap: bestOverlap, nx: bestAxisX, ny: bestAxisY };
}

function isFiniteParticle(point) {
  return Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.px)
    && Number.isFinite(point.py);
}

function normalizedBodyAxes(body) {
  const right = body.particles[5];
  const left = body.particles[11];
  const top = body.particles[2];
  const bottom = body.particles[8];
  const horizontalX = right.x - left.x;
  const horizontalY = right.y - left.y;
  const verticalX = bottom.x - top.x;
  const verticalY = bottom.y - top.y;
  const horizontalLength = Math.max(EPSILON, Math.hypot(horizontalX, horizontalY));
  const verticalLength = Math.max(EPSILON, Math.hypot(verticalX, verticalY));
  return {
    ux: horizontalX / horizontalLength,
    uy: horizontalY / horizontalLength,
    vx: verticalX / verticalLength,
    vy: verticalY / verticalLength,
  };
}

function gripAtPoint(body, x, y) {
  const center = body.particles[0];
  for (let index = 1; index < body.particles.length; index += 1) {
    const next = index === body.particles.length - 1 ? 1 : index + 1;
    const a = body.particles[index];
    const b = body.particles[next];
    const denominator = (a.y - b.y) * (center.x - b.x) + (b.x - a.x) * (center.y - b.y);
    if (Math.abs(denominator) < EPSILON) continue;
    const wc = ((a.y - b.y) * (x - b.x) + (b.x - a.x) * (y - b.y)) / denominator;
    const wa = ((b.y - center.y) * (x - b.x) + (center.x - b.x) * (y - b.y)) / denominator;
    const wb = 1 - wc - wa;
    if (wc >= -0.001 && wa >= -0.001 && wb >= -0.001) {
      return [{ index: 0, weight: wc }, { index, weight: wa }, { index: next, weight: wb }];
    }
  }
  return [{ index: 0, weight: 1 }];
}

function gripOffset(drag) {
  const center = drag.body.particles[0];
  let x = 0;
  let y = 0;
  for (const entry of drag.grip) {
    const point = drag.body.particles[entry.index];
    x += (point.x - center.x) * entry.weight;
    y += (point.y - center.y) * entry.weight;
  }
  return { x, y };
}

function createBody(id, x, y, width, height, variant, createdAt) {
  const particles = [makeParticle(x, y, 0.72)];
  for (const rest of REST_RING) {
    particles.push(makeParticle(x + rest.x * width, y + rest.y * height));
  }

  const constraints = [];
  const ringCount = REST_RING.length;
  for (let index = 0; index < ringCount; index += 1) {
    const current = index + 1;
    const next = ((index + 1) % ringCount) + 1;
    const second = ((index + 2) % ringCount) + 1;
    constraints.push(makeDistanceConstraint(particles, current, next, 0.49));
    constraints.push(makeDistanceConstraint(particles, current, second, 0.11));
    constraints.push(makeDistanceConstraint(particles, 0, current, 0.19));
  }
  for (let index = 0; index < ringCount / 2; index += 1) {
    constraints.push(makeDistanceConstraint(particles, index + 1, index + 1 + ringCount / 2, 0.075));
  }

  return {
    id,
    baseWidth: width,
    baseHeight: height,
    width,
    height,
    variant,
    createdAt,
    particles,
    constraints,
    restArea: polygonArea(particles.slice(1)),
    contactCount: 0,
    contactBodyIds: new Set(),
    impactSpeed: 0,
    stepVelocityY: 0,
    isGrounded: false,
    isSupported: false,
    supportBodyId: null,
    airborneSteps: 0,
    airborneStartY: y,
    fallDistance: 0,
    maximumFallSpeed: 0,
    isScared: false,
    lastImpactAt: -Infinity,
    dragPointer: null,
    expression: "neutral",
    expressionUntil: 0,
    followupExpression: null,
    followupUntil: 0,
    pokeDeformation: null,
    elasticShape: null,
    sadLanding: null,
    landingStabilizer: null,
    gestureStretch: 0,
    gestureSurprise: 0,
    gesturePout: 0,
    renderGestureSurprise: 0,
    renderGesturePout: 0,
    gestureDirectionX: 0,
    gestureDirectionY: -1,
    gestureAxes: null,
    gestureReleaseSpeed: 0,
    gestureReleaseReaction: null,
    floorCompression: 0,
    floorAxes: null,
    twoGripStretch: 1,
    twoGripAxis: null,
    twoGripRestAxes: null,
    twoGripPose: null,
    actualStretch: 1,
    isStretchCrying: false,
    stretchCryUntil: 0,
  };
}

function solveDistanceConstraint(body, constraint) {
  const a = body.particles[constraint.a];
  const b = body.particles[constraint.b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return;

  const weight = a.invMass + b.invMass;
  if (weight < EPSILON) return;

  let restLength = constraint.rest;
  if ((body.floorCompression > 0.002 && body.floorAxes) || Math.abs(body.twoGripStretch - 1) > 0.002) {
    const localA = constraint.a === 0 ? { x: 0, y: 0 } : REST_RING[constraint.a - 1];
    const localB = constraint.b === 0 ? { x: 0, y: 0 } : REST_RING[constraint.b - 1];
    const axes = body.twoGripRestAxes ?? body.floorAxes;
    const rx = (localB.x - localA.x) * body.width;
    const ry = (localB.y - localA.y) * body.height;
    const wx = axes.ux * rx + axes.vx * ry;
    const wy = axes.uy * rx + axes.vy * ry;
    const deformed = twoGripVector(body, wx, wy);
    const scales = floorScales(body);
    restLength *= Math.hypot(deformed.x * scales.x, deformed.y * scales.y) / Math.max(EPSILON, Math.hypot(wx, wy));
  }
  const correction = ((length - restLength) / length) * constraint.stiffness;
  const moveAX = dx * correction * (a.invMass / weight);
  const moveAY = dy * correction * (a.invMass / weight);
  const moveBX = dx * correction * (b.invMass / weight);
  const moveBY = dy * correction * (b.invMass / weight);
  a.x += moveAX;
  a.y += moveAY;
  b.x -= moveBX;
  b.y -= moveBY;
}

function solveAreaConstraint(body) {
  const ring = bodyRing(body);
  const currentArea = polygonArea(ring);
  const difference = currentArea - body.restArea * Math.sqrt(body.twoGripStretch);
  if (!Number.isFinite(difference) || Math.abs(difference) < 0.001) return;

  const gradients = [];
  let denominator = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const previous = ring[(index - 1 + ring.length) % ring.length];
    const next = ring[(index + 1) % ring.length];
    const point = ring[index];
    const gradient = {
      x: (next.y - previous.y) * 0.5,
      y: (previous.x - next.x) * 0.5,
    };
    gradients.push(gradient);
    denominator += point.invMass * (gradient.x * gradient.x + gradient.y * gradient.y);
  }
  if (denominator < EPSILON) return;

  const lambda = clamp((difference / denominator) * 0.085, -0.035, 0.035);
  for (let index = 0; index < ring.length; index += 1) {
    const point = ring[index];
    const gradient = gradients[index];
    point.x -= gradient.x * lambda * point.invMass;
    point.y -= gradient.y * lambda * point.invMass;
  }
}

function translateParticle(point, dx, dy, preserveVelocity = true, preserveRenderState = false) {
  point.x += dx;
  point.y += dy;
  if (preserveVelocity) {
    point.px += dx;
    point.py += dy;
  }
  if (preserveRenderState) {
    point.renderX += dx;
    point.renderY += dy;
  }
}

function floorScales(body) {
  return { x: 1 + body.floorCompression * 0.55, y: 1 - body.floorCompression * 0.45 };
}

function twoGripVector(body, x, y) {
  if (!body.twoGripAxis || Math.abs(body.twoGripStretch - 1) <= 0.002) return { x, y };
  const axis = body.twoGripAxis, parallel = x * axis.x + y * axis.y;
  const perpendicularX = x - axis.x * parallel, perpendicularY = y - axis.y * parallel;
  const thickness = Math.sqrt(body.twoGripStretch);
  return { x:axis.x * parallel * body.twoGripStretch + perpendicularX / thickness,
    y:axis.y * parallel * body.twoGripStretch + perpendicularY / thickness };
}

// Largest principal strain of two neighboring material elements. Undo floor
// compression first so a normal squash is not mistaken for painful pulling.
function materialStretch(body) {
  const center=body.particles[0],scales=floorScales(body),strains=[];
  for(let index=0;index<REST_RING.length;index++) {
    const next=(index+1)%REST_RING.length,a=REST_RING[index],b=REST_RING[next];
    const p=body.particles[index+1],q=body.particles[next+1];
    const px=(p.x-center.x)/scales.x,py=(p.y-center.y)/scales.y;
    const qx=(q.x-center.x)/scales.x,qy=(q.y-center.y)/scales.y;
    const det=(a.x*b.y-a.y*b.x)*body.width*body.height;
    const A=(px*b.y-qx*a.y)*body.height/det,B=(-px*b.x+qx*a.x)*body.width/det;
    const C=(py*b.y-qy*a.y)*body.height/det,D=(-py*b.x+qy*a.x)*body.width/det;
    const trace=A*A+B*B+C*C+D*D,d=A*D-B*C;
    strains.push(Math.sqrt((trace+Math.sqrt(Math.max(0,trace*trace-4*d*d)))*0.5));
  }
  strains.sort((a,b)=>b-a);
  return (strains[0]+strains[1])*0.5;
}

// Prevent a fan element turning inside out; ordinary dents remain unconstrained.
function solveMeshOrientation(body) {
  const center = body.particles[0];
  for (let index = 1; index < body.particles.length; index += 1) {
    const next = index === body.particles.length - 1 ? 1 : index + 1;
    const a = body.particles[index], b = body.particles[next];
    const ra = REST_RING[index - 1], rb = REST_RING[next - 1];
    const minimum = (ra.x * rb.y - ra.y * rb.x) * body.width * body.height * 0.035;
    const area = (a.x - center.x) * (b.y - center.y) - (a.y - center.y) * (b.x - center.x);
    if (area >= minimum) continue;
    const gradients = [
      { point: center, x: a.y - b.y, y: b.x - a.x },
      { point: a, x: b.y - center.y, y: center.x - b.x },
      { point: b, x: center.y - a.y, y: a.x - center.x },
    ];
    const denominator = gradients.reduce((sum, g) => sum + g.point.invMass * (g.x * g.x + g.y * g.y), 0);
    const lambda = (minimum - area) * 0.7 / Math.max(EPSILON, denominator);
    for (const g of gradients) {
      g.point.x += g.x * lambda * g.point.invMass;
      g.point.y += g.y * lambda * g.point.invMass;
    }
  }
}

export class SoftBodyWorld {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.width = Math.max(1, options.width ?? 390);
    this.height = Math.max(1, options.height ?? 844);
    this.floorInset = options.floorInset ?? this.config.floorInset;
    this.bodies = [];
    this.drags = new Map();
    this.events = [];
    this.time = 0;
    this.stepCount = 0;
    this.nextId = 1;
    this.contactNormals = new Map();
    this.paused = false;
    this.stopped = false;
  }

  get floorY() {
    return Math.max(40, this.height - this.floorInset);
  }

  addPudding(options = {}) {
    if (this.bodies.length >= this.config.maxBodies) return null;
    const width = clamp(options.width ?? Math.min(126, this.width * 0.3), 76, 148);
    const height = clamp(options.height ?? width * 0.78, 62, 120);
    const spawnIndex = this.bodies.length;
    const offsets = [0, -10, 12, -18, 21, -28, 32];
    const x = clamp(
      options.x ?? this.width * 0.5 + offsets[spawnIndex % offsets.length],
      width * 0.56,
      this.width - width * 0.56,
    );
    const y = options.y ?? Math.max(height * 0.7, 62 - spawnIndex * 4);
    const body = createBody(
      this.nextId,
      x,
      y,
      width,
      height,
      options.variant ?? (this.nextId - 1) % 4,
      this.time,
    );
    this.nextId += 1;
    if (Number.isFinite(options.vx) || Number.isFinite(options.vy)) {
      const vx = options.vx ?? 0;
      const vy = options.vy ?? 0;
      for (const point of body.particles) {
        point.px = point.x - vx / 60;
        point.py = point.y - vy / 60;
      }
    }
    this.bodies.push(body);
    this.events.push({ type: "added", bodyId: body.id, time: this.time });
    return body;
  }

  removeAll() {
    this.cancelAllDrags();
    this.bodies.length = 0;
    this.events.length = 0;
    this.nextId = 1;
    this.contactNormals.clear();
  }

  reset(count = 3) {
    this.removeAll();
    const total = clamp(Math.round(count), 0, this.config.maxBodies);
    const previewWidth = clamp(Math.min(126, this.width * 0.3), 76, 148);
    const maximumSpacing = previewWidth * 1.08;
    const availableSpacing = total > 1
      ? Math.max(54, (this.width - previewWidth * 1.08 - 12) / (total - 1))
      : 0;
    const spacing = Math.min(maximumSpacing, availableSpacing);
    for (let index = 0; index < total; index += 1) {
      this.addPudding({
        x: this.width * 0.5 + (index - (total - 1) * 0.5) * spacing,
        y: Math.max(58, this.floorY - 198 - (index % 2) * 28),
        vx: (index - 1) * 9,
      });
    }
  }

  getBody(bodyOrId) {
    if (typeof bodyOrId === "object" && bodyOrId) return bodyOrId;
    return this.bodies.find((body) => body.id === bodyOrId) ?? null;
  }

  hitTest(x, y, excludedBodyIds = null) {
    const ordered = [...this.bodies].sort((a, b) => {
      const ay = a.particles[0].y;
      const by = b.particles[0].y;
      return ay === by ? b.createdAt - a.createdAt : by - ay;
    });
    for (const body of ordered) {
      if (excludedBodyIds?.has(body.id)) continue;
      if (pointInPolygon(x, y, bodyRing(body))) return body;
    }
    return null;
  }

  beginDrag(pointerId, x, y, options = {}) {
    if (this.paused || this.stopped || this.drags.has(pointerId)) return null;
    const occupied = new Set(this.bodies.filter(body => this.bodyDrags(body).length >= 2).map(body => body.id));
    const body = this.hitTest(x, y, occupied);
    if (!body) return null;
    const existing = this.bodyDrags(body);
    if (existing.some(drag => Math.hypot(drag.targetX - x, drag.targetY - y) < 8)) return null;

    const center = body.particles[0];
    const drag = {
      pointerId,
      body,
      offsetX: center.x - x,
      offsetY: center.y - y,
      targetX: x,
      targetY: y,
      lastMoveX: 0,
      lastMoveY: 0,
      startX: x,
      startY: y,
      grip: gripAtPoint(body, x, y),
      inputTime: options.time ?? this.time,
      lastMotionInputTime: options.time ?? this.time,
      lastMotionWorldTime: this.time,
      velocityX: 0,
      velocityY: 0,
      maximumDistance: 0,
      axes: normalizedBodyAxes(body),
      floorGripClearance: Math.max(2, bodyAabb(body).maxY - y),
      ceilingGripClearance: Math.max(2, y - bodyAabb(body).minY),
      leftGripClearance: Math.max(2, x - bodyAabb(body).minX),
      rightGripClearance: Math.max(2, bodyAabb(body).maxX - x),
    };
    center.baseInvMass = center.baseInvMass || 0.72;
    drag.centerGrip = drag.grip[0].weight > 0.999;
    center.invMass = drag.centerGrip && existing.length === 0 ? 0 : center.baseInvMass;
    center.px = center.x;
    center.py = center.y;
    if (existing.length === 0) body.dragPointer = pointerId;
    body.isScared = false;
    body.sadLanding = null;
    body.landingStabilizer = null;
    body.gestureReleaseReaction = null;
    body.stretchCryUntil = 0;
    body.gestureReleaseSpeed = 0;
    if (existing.length === 0) body.gestureAxes = drag.axes;
    this.drags.set(pointerId, drag);
    return body;
  }

  bodyDrags(body) {
    return [...this.drags.values()].filter(drag => drag.body === body);
  }

  moveDrag(pointerId, x, y, options = {}) {
    const drag = this.drags.get(pointerId);
    if (!drag) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const inputTime = options.time ?? this.time;
    const sampleDt = clamp(inputTime - drag.inputTime, 1 / 240, 0.1);
    const deltaX = x - drag.targetX;
    const deltaY = y - drag.targetY;
    const sampleSpeed = Math.hypot(deltaX, deltaY) / sampleDt;
    const speedScale = sampleSpeed > GESTURE_TUNING.inputSpeedLimit
      ? GESTURE_TUNING.inputSpeedLimit / sampleSpeed : 1;
    const blend = 1 - Math.exp(-sampleDt / 0.035);
    drag.velocityX += (deltaX / sampleDt * speedScale - drag.velocityX) * blend;
    drag.velocityY += (deltaY / sampleDt * speedScale - drag.velocityY) * blend;
    drag.inputTime = inputTime;
    if (Math.hypot(deltaX, deltaY) > 0.1) {
      drag.lastMotionWorldTime = this.time;
      drag.lastMotionInputTime = inputTime;
    }
    drag.lastMoveX = clamp(deltaX, -28, 28);
    drag.lastMoveY = clamp(deltaY, -28, 28);
    drag.targetX = x;
    drag.targetY = y;
    drag.maximumDistance = Math.max(drag.maximumDistance, Math.hypot(x - drag.startX, y - drag.startY));
    return true;
  }

  endDrag(pointerId, options = {}) {
    const drag = this.drags.get(pointerId);
    if (!drag) return null;
    const center = drag.body.particles[0];
    this.drags.delete(pointerId);
    const remaining = this.bodyDrags(drag.body);
    if (remaining.length > 0) {
      drag.body.dragPointer = remaining[0].pointerId;
      center.invMass = remaining.length === 1 && remaining[0].centerGrip ? 0 : center.baseInvMass;
      drag.body.gestureReleaseSpeed = 0;
      // Resistant grips may lag behind the raw finger: keep the material point.
      const kept = remaining[0], offset = gripOffset(kept);
      kept.inputOffsetX = kept.targetX - center.x - offset.x;
      kept.inputOffsetY = kept.targetY - center.y - offset.y;
      kept.axes = drag.body.twoGripRestAxes ?? normalizedBodyAxes(drag.body);
      drag.body.gestureAxes = kept.axes;
      drag.body.twoGripPose = null;
      // The remaining barycentric grip is unchanged: no recenter, throw or face jump.
      return drag.body;
    }
    center.invMass = center.baseInvMass;
    const body = drag.body;
    body.twoGripPose = null;
    body.stretchCryUntil = !options.cancel && body.isStretchCrying ? this.time + 0.3 : 0;
    body.isStretchCrying = false;
    const idleTime = options.time === undefined ? this.time - drag.lastMotionWorldTime
      : options.time - drag.lastMotionInputTime;
    const freshness = Math.exp(-Math.max(0, idleTime) / 0.07);
    const rawSpeed = Math.hypot(drag.velocityX, drag.velocityY) * freshness;
    const throwAmount = smoothstep01((rawSpeed - 90) / 440);
    const releaseScale = rawSpeed > GESTURE_TUNING.releaseSpeedLimit
      ? GESTURE_TUNING.releaseSpeedLimit / rawSpeed : 1;
    const throwX = options.cancel ? 0 : drag.velocityX * freshness * releaseScale
      * GESTURE_TUNING.releaseVelocityScale * throwAmount / 60;
    const throwY = options.cancel ? 0 : drag.velocityY * freshness * releaseScale
      * GESTURE_TUNING.releaseVelocityScale * throwAmount / 60;
    const retainedVelocity = options.cancel ? 0.02 : 0.06;
    for (const point of drag.body.particles) {
      const velocityX = point.x - point.px;
      const velocityY = point.y - point.py;
      point.px = point.x - velocityX * retainedVelocity - throwX;
      point.py = point.y - velocityY * retainedVelocity - throwY;
    }
    center.px = center.x - throwX;
    center.py = center.y - throwY;
    if (!options.cancel) this.applyReleaseWobble(drag.body, drag.lastMoveX, drag.lastMoveY);
    body.gestureReleaseSpeed = options.cancel ? 0 : Math.min(rawSpeed, GESTURE_TUNING.releaseSpeedLimit);
    if (!options.cancel && drag.maximumDistance >= GESTURE_TUNING.minimumReactionDistance) {
      body.gestureReleaseReaction = {
        startAt: this.time + Math.max(GESTURE_TUNING.poutDelay, body.stretchCryUntil - this.time),
        endAt: this.time + Math.max(GESTURE_TUNING.poutDelay, body.stretchCryUntil - this.time) + GESTURE_TUNING.poutDuration,
        intensity: clamp(0.35 + body.gestureStretch * 0.6, 0.35, 0.95),
      };
    } else {
      body.gestureReleaseReaction = null;
    }
    drag.body.dragPointer = null;
    this.drags.delete(pointerId);
    this.events.push({ type: options.cancel ? "drag-cancel" : "released", bodyId: drag.body.id,
      speed: body.gestureReleaseSpeed, time: this.time });
    return drag.body;
  }

  cancelAllDrags() {
    for (const pointerId of [...this.drags.keys()]) {
      this.endDrag(pointerId, { cancel: true });
    }
  }

  poke(bodyOrId, x, y, strength = 1) {
    const body = this.getBody(bodyOrId) ?? this.hitTest(x, y);
    if (!body) return false;
    const center = body.particles[0];
    let nearestIndex = 1;
    let nearestDistance = Infinity;
    for (let index = 1; index < body.particles.length; index += 1) {
      const point = body.particles[index];
      const candidate = Math.hypot(point.x - x, point.y - y);
      if (candidate < nearestDistance) {
        nearestDistance = candidate;
        nearestIndex = index;
      }
    }

    const amount = clamp(Math.min(body.width, body.height) * 0.13 * strength, 5, 18);
    const primary = body.particles[nearestIndex];
    const dx = center.x - primary.x;
    const dy = center.y - primary.y;
    const length = Math.max(EPSILON, Math.hypot(dx, dy));
    const nx = dx / length;
    const ny = dy / length;
    const ringCount = REST_RING.length;
    const ringIndex = nearestIndex - 1;
    const affected = [
      { index: nearestIndex, weight: 1 },
      { index: ((ringIndex - 1 + ringCount) % ringCount) + 1, weight: 0.42 },
      { index: ((ringIndex + 1) % ringCount) + 1, weight: 0.42 },
    ];
    const deformationPoints = [];
    for (const entry of affected) {
      const point = body.particles[entry.index];
      deformationPoints.push({
        index: entry.index,
        restRadius: Math.hypot(point.x - center.x, point.y - center.y),
        indentation: amount * entry.weight,
      });
      const moveX = nx * amount * entry.weight;
      const moveY = ny * amount * entry.weight;
      translateParticle(point, moveX, moveY, true, true);
    }
    body.pokeDeformation = {
      startedAt: this.time,
      duration: 0.44,
      points: deformationPoints,
    };

    this.setExpression(body, "hmph", 0.42, "sly", 1.05);
    this.events.push({ type: "poke", bodyId: body.id, x, y, time: this.time });
    return true;
  }

  setExpression(bodyOrId, expression, duration, followupExpression = null, followupDuration = 0) {
    const body = this.getBody(bodyOrId);
    if (!body) return;
    body.expression = expression;
    body.expressionUntil = this.time + duration;
    body.followupExpression = followupExpression;
    body.followupUntil = body.expressionUntil + followupDuration;
  }

  expressionFor(bodyOrId) {
    const body = this.getBody(bodyOrId);
    if (!body) return "neutral";
    if (body.isStretchCrying || this.time < body.stretchCryUntil) return "cry";
    if (body.isScared) return "eek";
    if (body.sadLanding
      && this.time >= body.sadLanding.startAt
      && this.time <= body.sadLanding.endAt) return "sad";
    if (this.time <= body.expressionUntil) return body.expression;
    if (body.followupExpression && this.time <= body.followupUntil) return body.followupExpression;
    return "neutral";
  }

  faceStateFor(bodyOrId) {
    const body = this.getBody(bodyOrId);
    return { expression: this.expressionFor(body),
      surprise: body?.gestureSurprise ?? 0, pout: body?.gesturePout ?? 0 };
  }

  setPaused(value) {
    this.paused = Boolean(value);
    if (this.paused) this.cancelAllDrags();
  }

  stop() {
    this.stopped = true;
    this.cancelAllDrags();
  }

  start() {
    this.stopped = false;
  }

  resize(width, height, floorInset = this.floorInset) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    const nextFloorInset = clamp(floorInset, 48, Math.max(48, nextHeight * 0.42));
    if (this.width === nextWidth && this.height === nextHeight && this.floorInset === nextFloorInset) return;
    this.cancelAllDrags();
    const oldWidth = this.width;
    const oldFloor = this.floorY;
    this.width = nextWidth;
    this.height = nextHeight;
    this.floorInset = nextFloorInset;
    const newFloor = this.floorY;
    const scaleX = this.width / oldWidth;
    const verticalScale = clamp(newFloor / Math.max(1, oldFloor), 0.72, 1.2);

    for (const body of this.bodies) {
      const center = body.particles[0];
      const targetWidth = clamp(Math.min(body.baseWidth, this.width * 0.3), 72, body.baseWidth);
      const bodyScale = targetWidth / body.width;
      if (Math.abs(bodyScale - 1) > 0.001) {
        const centerX = center.x;
        const centerY = center.y;
        const previousCenterX = center.px;
        const previousCenterY = center.py;
        for (const point of body.particles) {
          point.x = centerX + (point.x - centerX) * bodyScale;
          point.y = centerY + (point.y - centerY) * bodyScale;
          point.px = previousCenterX + (point.px - previousCenterX) * bodyScale;
          point.py = previousCenterY + (point.py - previousCenterY) * bodyScale;
        }
        for (const constraint of body.constraints) constraint.rest *= bodyScale;
        body.restArea *= bodyScale * bodyScale;
        body.width *= bodyScale;
        body.height *= bodyScale;
      }
      const targetX = clamp(center.x * scaleX, body.width * 0.54, this.width - body.width * 0.54);
      const heightAboveFloor = oldFloor - center.y;
      const targetY = clamp(newFloor - heightAboveFloor * verticalScale, body.height * 0.55, newFloor - 2);
      const dx = targetX - center.x;
      const dy = targetY - center.y;
      for (const point of body.particles) translateParticle(point, dx, dy, true);

      const bounds = bodyAabb(body);
      let nudgeX = 0;
      let nudgeY = 0;
      if (bounds.minX < this.config.wallPadding) nudgeX = this.config.wallPadding - bounds.minX;
      if (bounds.maxX > this.width - this.config.wallPadding) {
        nudgeX = this.width - this.config.wallPadding - bounds.maxX;
      }
      if (bounds.maxY > newFloor) nudgeY = newFloor - bounds.maxY;
      for (const point of body.particles) translateParticle(point, nudgeX, nudgeY, true);
      for (const point of body.particles) {
        point.renderX = point.x;
        point.renderY = point.y;
      }
      body.renderGestureSurprise = body.gestureSurprise;
      body.renderGesturePout = body.gesturePout;
    }
  }

  step(dt = 1 / 60) {
    if (this.paused || this.stopped || this.bodies.length === 0) return;
    const safeDt = clamp(dt, 1 / 240, 1 / 25);
    this.time += safeDt;
    this.stepCount += 1;

    for (const body of this.bodies) {
      body.contactCount = 0;
      body.contactBodyIds.clear();
      body.impactSpeed = 0;
      const center = body.particles[0];
      body.stepVelocityY = (center.y - center.py) / safeDt;
      for (const point of body.particles) {
        point.renderX = point.x;
        point.renderY = point.y;
      }
      body.renderGestureSurprise = body.gestureSurprise;
      body.renderGesturePout = body.gesturePout;
      this.updateTransientStates(body, safeDt);
      this.integrateBody(body, safeDt);
    }
    this.updateTwoGripElasticity(safeDt);
    this.updateFloorCompression(safeDt);
    this.applyDragLag();
    this.updateDragGestures(safeDt);

    for (let iteration = 0; iteration < this.config.iterations; iteration += 1) {
      this.applyDragTargets();
      for (const body of this.bodies) {
        for (const constraint of body.constraints) solveDistanceConstraint(body, constraint);
        solveAreaConstraint(body);
        this.solveGestureStretch(body);
        this.solvePokeDeformation(body);
        this.solveTransientShape(body);
        this.solveFloorCompression(body);
        solveMeshOrientation(body);
      }
      this.solveBodyCollisions();
      for (const body of this.bodies) this.solveBounds(body, safeDt);
    }

    this.applyDragPose();
    this.applyDragTargets(true);
    for (const body of this.bodies) {
      for (let guard = 0; guard < 3; guard += 1) solveMeshOrientation(body);
      this.solveBounds(body, safeDt);
    }
    // Pointer targets used to be the final operation of a step, which let a
    // finger place a body through another body until the next frame. Resolve
    // contacts again after pointer following so incompatible puddings resist
    // the hand continuously instead of swapping places.
    for (let guard = 0; guard < 3; guard += 1) {
      this.solveBodyCollisions();
      for (const body of this.bodies) {
        solveMeshOrientation(body);
        this.solveBounds(body, safeDt);
      }
    }
    this.finishContacts();
    this.dampRestingContacts(safeDt);
    for (const body of this.bodies) this.updateGestureFace(body, safeDt);
    this.recoverInvalidBodies();
  }

  integrateBody(body, dt) {
    for (const point of body.particles) {
      if (point.invMass <= 0) continue;
      const vx = clamp((point.x - point.px) * this.config.airDamping, -this.config.maxStepVelocity, this.config.maxStepVelocity);
      const vy = clamp((point.y - point.py) * this.config.airDamping, -this.config.maxStepVelocity, this.config.maxStepVelocity);
      point.px = point.x;
      point.py = point.y;
      point.x += vx;
      point.y += vy + this.config.gravity * dt * dt;
    }
  }

  dampRestingContacts(dt) {
    // Constraint corrections otherwise recycle energy indefinitely in a pile.
    // Leave the hand, throws, landing squashes and intentional little hops free.
    const damping = Math.exp(-dt * 32);
    for (const body of this.bodies) {
      if (body.dragPointer !== null || (!body.isSupported && body.contactBodyIds.size === 0) || body.elasticShape
        || this.floorY - body.particles[0].y > body.height * 3.4
        || body.pokeDeformation || this.time - body.lastImpactAt < 0.6
        || body.gestureStretch > 0.02 || Math.abs(body.twoGripStretch - 1) > 0.02) continue;
      for (const point of body.particles) {
        point.px = point.x - (point.x - point.px) * damping;
        point.py = point.y - (point.y - point.py) * damping;
      }
    }
  }

  applyDragTargets(finalPass = false) {
    for (const body of this.bodies) {
      const drags = this.bodyDrags(body);
      if (drags.length === 2) {
        this.applyTwoGripTargets(body, drags, finalPass);
        continue;
      }
      const drag = drags[0];
      if (!drag) continue;
      const center = drag.body.particles[0];
      const offset = gripOffset(drag);
      const target = this.effectiveDragTarget(drag);
      const targetX = target.x, targetY = target.y;
      if (drag.centerGrip) {
        center.x = clamp(targetX, drag.body.width * 0.45, this.width - drag.body.width * 0.45);
        center.y = clamp(targetY, drag.body.height * 0.45,
          this.floorY - drag.body.height * 0.51 * floorScales(drag.body).y);
        if (finalPass) {
          center.px = center.x;
          center.py = center.y;
        }
      } else {
        const deltaX = targetX - center.x - offset.x;
        const deltaY = targetY - center.y - offset.y;
        let denominator = 0;
        for (const entry of drag.grip) {
          denominator += entry.weight * entry.weight * drag.body.particles[entry.index].baseInvMass;
        }
        for (const entry of drag.grip) {
          const point = drag.body.particles[entry.index];
          const weight = entry.weight * point.baseInvMass / Math.max(EPSILON, denominator);
          point.x += deltaX * weight;
          point.y += deltaY * weight;
          if (finalPass) {
            point.px = point.x;
            point.py = point.y;
          }
        }
      }
    }
  }

  applyTwoGripTargets(body, drags, finalPass) {
    const targets = this.twoGripTargets(body, drags);
    const weights = drags.map(drag => {
      const values = body.particles.map(() => 0);
      for (const entry of drag.grip) values[entry.index] = entry.weight;
      return values;
    });
    const residual = targets.map((target, index) => ({
      x: target.x - body.particles.reduce((sum,p,i) => sum + p.x * weights[index][i], 0),
      y: target.y - body.particles.reduce((sum,p,i) => sum + p.y * weights[index][i], 0),
    }));
    let a = 0, b = 0, cross = 0;
    for (let index = 0; index < body.particles.length; index += 1) {
      const mass = body.particles[index].baseInvMass;
      a += weights[0][index] ** 2 * mass;
      b += weights[1][index] ** 2 * mass;
      cross += weights[0][index] * weights[1][index] * mass;
    }
    const determinant = Math.max(EPSILON, a * b - cross * cross);
    const lambda = residual.map((r,index) => {
      const other = residual[1-index], diagonal = index === 0 ? b : a;
      return { x:(diagonal*r.x-cross*other.x)/determinant, y:(diagonal*r.y-cross*other.y)/determinant };
    });
    for (let index = 0; index < body.particles.length; index += 1) {
      const point = body.particles[index];
      const mx = (weights[0][index]*lambda[0].x+weights[1][index]*lambda[1].x)*point.baseInvMass;
      const my = (weights[0][index]*lambda[0].y+weights[1][index]*lambda[1].y)*point.baseInvMass;
      point.x += clamp(mx, -30, 30);
      point.y += clamp(my, -30, 30);
      if (finalPass && (weights[0][index] !== 0 || weights[1][index] !== 0)) {
        point.px = point.x;
        point.py = point.y;
      }
    }
  }

  effectiveDragTarget(drag) {
    const body = drag.body, scales = floorScales(body);
    const axis = body.twoGripAxis ?? {x:1,y:0}, stretch = body.twoGripStretch;
    const scaleX = scales.x * Math.hypot(axis.x*stretch,axis.y/stretch);
    const scaleY = scales.y * Math.hypot(axis.y*stretch,axis.x/stretch);
    const left = this.config.wallPadding + drag.leftGripClearance*scaleX;
    const right = this.width-this.config.wallPadding-drag.rightGripClearance*scaleX;
    const top = Math.max(8,2+drag.ceilingGripClearance*scaleY);
    const bottom = this.floorY-Math.max(6,drag.floorGripClearance*scaleY);
    const target = {x:clamp(drag.targetX-(drag.inputOffsetX??0),Math.min(left,right),Math.max(left,right)),
      y:clamp(drag.targetY-(drag.inputOffsetY??0),Math.min(top,bottom),Math.max(top,bottom))};
    return this.constrainDragTarget(drag, target, gripOffset(drag));
  }

  constrainDragTarget(_drag, target) {
    return target;
  }

  applyDragPose() {
    for (const drag of this.drags.values()) {
      if (this.bodyDrags(drag.body).length > 1) continue;
      const movementLength = Math.hypot(drag.lastMoveX, drag.lastMoveY);
      if (movementLength >= 0.2) {
        const directionX = drag.lastMoveX / movementLength;
        const directionY = drag.lastMoveY / movementLength;
        const maximumLag = Math.min(drag.body.height * 0.085, movementLength * 0.34);
        for (let index = 1; index < drag.body.particles.length; index += 1) {
          const upperWeight = clamp((-REST_RING[index - 1].y + 0.08) / 0.6, 0, 1);
          if (upperWeight <= 0) continue;
          translateParticle(
            drag.body.particles[index],
            -directionX * maximumLag * upperWeight,
            -directionY * maximumLag * upperWeight,
            true,
          );
        }
      }
      drag.lastMoveX *= 0.42;
      drag.lastMoveY *= 0.42;
    }
  }

  applyDragLag() {
    for (const drag of this.drags.values()) {
      if (this.bodyDrags(drag.body).length > 1) continue;
      const center = drag.body.particles[0];
      const offset = gripOffset(drag);
      const target = this.effectiveDragTarget(drag);
      const targetX = clamp(
        target.x - offset.x,
        drag.body.width * 0.45,
        this.width - drag.body.width * 0.45,
      );
      const targetY = clamp(
        target.y - offset.y,
        drag.body.height * 0.45,
        this.floorY - drag.body.height * 0.26,
      );
      const movementX = targetX - center.x;
      const movementY = targetY - center.y;
      const movementLength = Math.hypot(movementX, movementY);
      if (movementLength < 0.2) continue;
      const lagDistance = Math.min(movementLength * 0.16, drag.body.height * 0.12);
      const directionX = movementX / movementLength;
      const directionY = movementY / movementLength;
      if (!drag.centerGrip) {
        translateParticle(center, movementX - directionX * lagDistance,
          movementY - directionY * lagDistance, true);
      }
      for (let index = 1; index < drag.body.particles.length; index += 1) {
        const rest = REST_RING[index - 1];
        const upperWeight = clamp((-rest.y + 0.08) / 0.6, 0, 1);
        const lag = lagDistance * (0.18 + upperWeight * 0.82);
        translateParticle(
          drag.body.particles[index],
          movementX - directionX * lag,
          movementY - directionY * lag,
          true,
        );
      }
    }
  }

  updateDragGestures(dt) {
    for (const body of this.bodies) {
      const drags = this.bodyDrags(body);
      if (drags.length === 0) continue;
      const drag = drags[0], second = drags[1];
      const deltaX = second ? second.targetX - drag.targetX : drag.targetX - drag.startX;
      const deltaY = second ? second.targetY - drag.targetY : drag.targetY - drag.startY;
      const distanceMoved = Math.hypot(deltaX, deltaY);
      if (distanceMoved > 2) {
        body.gestureDirectionX = deltaX / distanceMoved;
        body.gestureDirectionY = deltaY / distanceMoved;
      }
      const lastMotion = Math.max(...drags.map(entry => entry.lastMotionWorldTime));
      const idleTime = Math.max(0, this.time - lastMotion - 0.025);
      const activity = Math.exp(-idleTime / 0.11);
      const initialSpan = second ? Math.hypot(second.startX-drag.startX,second.startY-drag.startY) : 0;
      const reactionDistance = second ? Math.max(0,distanceMoved-initialSpan) : distanceMoved;
      const target = smoothstep01(reactionDistance / (body.height * GESTURE_TUNING.stretchDistanceFactor))
        * activity;
      const response = 1 - Math.exp(-dt / (target > body.gestureStretch ? 0.085 : 0.15));
      body.gestureStretch += (target - body.gestureStretch) * response;
    }
  }

  updateFloorCompression(dt) {
    for (const body of this.bodies) {
      let target = 0;
      for (const drag of this.drags.values()) {
        if (drag.body !== body) continue;
        const pressure = drag.targetY - (this.floorY - drag.floorGripClearance);
        target = Math.max(target, smoothstep01(pressure / (body.height * 0.65)));
        if (pressure > 0) body.floorAxes = drag.axes;
      }
      body.floorCompression += (target - body.floorCompression) * (1 - Math.exp(-dt / (target > body.floorCompression ? 0.075 : 0.14)));
      if (body.floorCompression < 0.0001) body.floorCompression = 0;
    }
  }

  updateTwoGripElasticity(dt) {
    for (const body of this.bodies) {
      const drags = this.bodyDrags(body);
      let target = 1;
      if (drags.length === 2) {
        const dx = drags[1].targetX-drags[0].targetX, dy = drags[1].targetY-drags[0].targetY;
        const span = Math.hypot(dx,dy), key = drags.map(d=>d.pointerId).join(":");
        if (!body.twoGripPose || body.twoGripPose.key !== key) {
          const a = gripOffset(drags[0]), b = gripOffset(drags[1]);
          const angle = Math.atan2(b.y-a.y,b.x-a.x);
          body.twoGripPose = {key,initialSpan:Math.max(8,Math.hypot(b.x-a.x,b.y-a.y)),angle,
            inputAngle:Math.atan2(dy,dx),materialAngle:angle};
          body.twoGripRestAxes = normalizedBodyAxes(body);
          body.twoGripStretch = 1;
        }
        const pose = body.twoGripPose;
        // Progressive resistance: derivative 1 near rest, tending to zero at
        // 1.8x. Closing/crossing fingers cannot annihilate a material diameter.
        const ratio = span/pose.initialSpan;
        target = ratio >= 1 ? 1+0.8*(1-Math.exp(-(ratio-1)/0.8))
          : 1-0.18*(1-Math.exp(-(1-ratio)/0.18));
        const desired = Math.atan2(dy,dx)-pose.inputAngle+pose.materialAngle;
        const delta = Math.atan2(Math.sin(desired-pose.angle),Math.cos(desired-pose.angle));
        const rotation = span > pose.initialSpan*0.16 ? clamp(delta,-8*dt,8*dt) : 0;
        pose.angle += rotation;
        const c=Math.cos(rotation),s=Math.sin(rotation),center=body.particles[0];
        // Transport the whole material frame (including velocity) together.
        // This is external finger torque, not a replacement/reset of the mesh.
        const oldX=center.x,oldY=center.y,oldPX=center.px,oldPY=center.py;
        for(const point of body.particles.slice(1)) {
          const x=point.x-oldX,y=point.y-oldY,px=point.px-oldPX,py=point.py-oldPY;
          point.x=oldX+c*x-s*y;point.y=oldY+s*x+c*y;
          point.px=oldPX+c*px-s*py;point.py=oldPY+s*px+c*py;
        }
        const axes=body.twoGripRestAxes;
        body.twoGripRestAxes={ux:c*axes.ux-s*axes.uy,uy:s*axes.ux+c*axes.uy,
          vx:c*axes.vx-s*axes.vy,vy:s*axes.vx+c*axes.vy};
        body.twoGripAxis={x:Math.cos(pose.angle),y:Math.sin(pose.angle)};
        body.gestureAxes=body.twoGripRestAxes;
      }
      body.twoGripStretch += (target-body.twoGripStretch)*(1-Math.exp(-dt/(drags.length===2?0.07:0.22)));
      if (Math.abs(body.twoGripStretch-1) < 0.0001) {
        body.twoGripStretch = 1;
        if(drags.length!==2) {
          body.twoGripRestAxes=null;
          body.twoGripAxis=null;
        }
      }
      if(drags.length===2) {
        const targets=this.twoGripTargets(body,drags);
        const offsets=drags.map(d=>gripOffset(d));
        const dx=(targets[0].x+targets[1].x)*0.5-body.particles[0].x-(offsets[0].x+offsets[1].x)*0.5;
        const dy=(targets[0].y+targets[1].y)*0.5-body.particles[0].y-(offsets[0].y+offsets[1].y)*0.5;
        const scale=Math.min(1,18/Math.max(EPSILON,Math.hypot(dx,dy)));
        for(const point of body.particles)translateParticle(point,dx*scale,dy*scale,true);
      }
    }
  }

  posedOffsets(body) {
    const axes=body.twoGripRestAxes ?? body.floorAxes ?? normalizedBodyAxes(body),scales=floorScales(body);
    return [{x:0,y:0},...REST_RING.map(rest=>{
      const v=twoGripVector(body,axes.ux*rest.x*body.width+axes.vx*rest.y*body.height,
        axes.uy*rest.x*body.width+axes.vy*rest.y*body.height);
      return {x:v.x*scales.x,y:v.y*scales.y};
    })];
  }

  twoGripTargets(body,drags) {
    const offsets=this.posedOffsets(body);
    const grips=drags.map(d=>d.grip.reduce((v,e)=>({x:v.x+offsets[e.index].x*e.weight,
      y:v.y+offsets[e.index].y*e.weight}),{x:0,y:0}));
    const mx=(drags[0].targetX+drags[1].targetX)*0.5-(grips[0].x+grips[1].x)*0.5;
    const my=(drags[0].targetY+drags[1].targetY)*0.5-(grips[0].y+grips[1].y)*0.5;
    const x=clamp(mx,this.config.wallPadding-Math.min(...offsets.map(p=>p.x)),
      this.width-this.config.wallPadding-Math.max(...offsets.map(p=>p.x)));
    const y=clamp(my,2-Math.min(...offsets.map(p=>p.y)),this.floorY-Math.max(...offsets.map(p=>p.y)));
    return grips.map(g=>({x:x+g.x,y:y+g.y}));
  }

  solveFloorCompression(body) {
    if (body.floorCompression < 0.002 || body.dragPointer === null || !body.floorAxes) return;
    if (!this.bodyDrags(body).some(drag => drag.targetY > this.floorY-drag.floorGripClearance)) return;
    const axes = body.twoGripRestAxes ?? body.floorAxes;
    const scales = floorScales(body);
    const center = body.particles[0];
    const offsets = REST_RING.map(rest => twoGripVector(body,
      axes.ux * rest.x * body.width + axes.vx * rest.y * body.height,
      axes.uy * rest.x * body.width + axes.vy * rest.y * body.height));
    const bottom = Math.max(...offsets.map(offset => offset.y));
    const centerY = this.floorY - bottom * scales.y;
    if (center.invMass > 0) {
      translateParticle(center, 0, (centerY - center.y) * 0.24, true);
    }
    for (let index = 0; index < REST_RING.length; index += 1) {
      const targetX = center.x + offsets[index].x * scales.x;
      const targetY = centerY + offsets[index].y * scales.y;
      const point = body.particles[index + 1];
      translateParticle(point, (targetX - point.x) * 0.2, (targetY - point.y) * 0.2, true);
    }
  }

  solveGestureStretch(body) {
    const amount = body.gestureStretch;
    const pair = this.bodyDrags(body).length === 2;
    if (amount < 0.002 && !pair && Math.abs(body.twoGripStretch-1)<0.002) return;
    const drag = body.dragPointer !== null ? this.drags.get(body.dragPointer) : null;
    const axes = body.twoGripRestAxes ?? drag?.axes ?? body.gestureAxes ?? normalizedBodyAxes(body);
    const center = body.particles[0];
    const directionX = body.gestureDirectionX;
    const directionY = body.gestureDirectionY;
    const strength = body.dragPointer !== null ? 0.17 : 0.12;
    let correctionX = 0;
    let correctionY = 0;
    for (let index = 0; index < REST_RING.length; index += 1) {
      const rest = REST_RING[index];
      const strain = twoGripVector(body,
        axes.ux * rest.x * body.width + axes.vx * rest.y * body.height,
        axes.uy * rest.x * body.width + axes.vy * rest.y * body.height);
      const scales = floorScales(body);
      const localX = strain.x * scales.x;
      const localY = strain.y * scales.y;
      const parallel = localX * directionX + localY * directionY;
      const perpendicularX = localX - directionX * parallel;
      const perpendicularY = localY - directionY * parallel;
      const dualRecovery = pair || Math.abs(body.twoGripStretch-1)>0.002;
      const parallelGain = 1 + (dualRecovery ? 0 : amount) * GESTURE_TUNING.stretchParallelGain;
      const perpendicularScale = 1 / parallelGain;
      const trailingWeight = clamp(0.5 - parallel / body.height, 0, 1);
      const trail = (dualRecovery ? 0 : amount) * body.height * GESTURE_TUNING.stretchTrailGain * trailingWeight;
      const targetX = center.x + directionX * (parallel * parallelGain - trail)
        + perpendicularX * perpendicularScale;
      const targetY = center.y + directionY * (parallel * parallelGain - trail)
        + perpendicularY * perpendicularScale;
      const point = body.particles[index + 1];
      const dx = (targetX - point.x) * strength;
      const dy = (targetY - point.y) * strength;
      point.x += dx;
      point.y += dy;
      correctionX += dx / point.baseInvMass;
      correctionY += dy / point.baseInvMass;
    }
    // Internal shape recovery must not manufacture translational momentum.
    // Only a pinned center may exchange force with the external pointer.
    if (center.invMass > 0 && body.dragPointer === null) {
      const totalMass = body.particles.reduce((sum, point) => sum + 1 / point.baseInvMass, 0);
      for (const point of body.particles) {
        point.x -= correctionX / totalMass;
        point.y -= correctionY / totalMass;
      }
    }
  }

  updateGestureFace(body, dt) {
    body.actualStretch += (materialStretch(body)-body.actualStretch)*(1-Math.exp(-dt/0.035));
    const held=body.dragPointer!==null;
    if(!held) body.isStretchCrying=false;
    else if(!body.isStretchCrying && body.actualStretch>1.18) body.isStretchCrying=true;
    else if(body.isStretchCrying && body.actualStretch<1.10) body.isStretchCrying=false;
    const targetSurprise = clamp(body.gestureStretch * 1.1, 0, 1);
    const surpriseResponse = 1 - Math.exp(-dt / (targetSurprise > body.gestureSurprise ? 0.055 : 0.11));
    body.gestureSurprise += (targetSurprise - body.gestureSurprise) * surpriseResponse;
    let targetPout = 0;
    const reaction = body.gestureReleaseReaction;
    if (reaction) {
      if (this.time > reaction.endAt) body.gestureReleaseReaction = null;
      else if (this.time >= reaction.startAt) {
        const progress = (this.time - reaction.startAt) / (reaction.endAt - reaction.startAt);
        targetPout = Math.sin(Math.PI * progress) * reaction.intensity;
      }
    }
    body.gesturePout += (targetPout - body.gesturePout) * (1 - Math.exp(-dt / 0.08));
    if (body.gestureSurprise < 0.0001) body.gestureSurprise = 0;
    if (body.gesturePout < 0.0001) body.gesturePout = 0;
  }

  applyReleaseWobble(body, movementX, movementY) {
    const motionX = clamp(movementX, -16, 16);
    const motionY = clamp(movementY, -16, 16);
    if (Math.hypot(motionX, motionY) < 0.5) return;
    for (let index = 1; index < body.particles.length; index += 1) {
      const rest = REST_RING[index - 1];
      const upperWeight = clamp((-rest.y + 0.1) / 0.62, 0, 1);
      const counterWeight = (1 - upperWeight) * -0.16;
      const weight = upperWeight + counterWeight;
      const point = body.particles[index];
      point.px -= motionX * 0.075 * weight;
      point.py -= motionY * 0.075 * weight;
    }
  }

  updateTransientStates(body, dt) {
    if (body.dragPointer === null) body.gestureStretch *= Math.exp(-dt / 0.13);
    if (body.landingStabilizer) {
      const stabilizer = body.landingStabilizer;
      if (this.time > stabilizer.endAt) {
        body.landingStabilizer = null;
      } else {
        const center = body.particles[0];
        const correctionX = clamp((stabilizer.anchorX - center.x) * 0.14, -1.4, 1.4);
        for (const point of body.particles) {
          translateParticle(point, correctionX, 0, true);
          const velocityX = point.x - point.px;
          point.px = point.x - velocityX * 0.52;
        }
      }
    }
    if (body.elasticShape) {
      const state = body.elasticShape;
      state.velocity += (-220 * state.value - 8.2 * state.velocity) * dt;
      state.value += state.velocity * dt;
      state.age += dt;
      if (!Number.isFinite(state.value)
        || state.age > 1.05
        || (state.age > 0.72 && Math.abs(state.value) < 0.009 && Math.abs(state.velocity) < 0.08)) {
        body.elasticShape = null;
      }
    }
    if (body.sadLanding && this.time > body.sadLanding.endAt) {
      body.sadLanding = null;
      this.startElasticShape(body, -0.13);
    }
  }

  sadEnvelope(body) {
    if (!body.sadLanding
      || this.time < body.sadLanding.startAt
      || this.time > body.sadLanding.endAt) return 0;
    const progress = clamp(
      (this.time - body.sadLanding.startAt) / (body.sadLanding.endAt - body.sadLanding.startAt),
      0,
      1,
    );
    return Math.pow(Math.sin(progress * Math.PI), 0.72);
  }

  solveTransientShape(body) {
    const elasticValue = body.elasticShape?.value ?? 0;
    const sadValue = this.sadEnvelope(body);
    const squash = clamp(elasticValue + sadValue * 1.28, -0.55, 1.45);
    if (Math.abs(squash) < 0.002) return;

    const axes = normalizedBodyAxes(body);
    const center = body.particles[0];
    const horizontalScale = 1 + squash * 0.09;
    const verticalScale = 1 - squash * 0.15;
    const strength = sadValue > 0 ? 0.09 : 0.052;
    for (let index = 0; index < REST_RING.length; index += 1) {
      const rest = REST_RING[index];
      const targetX = center.x
        + axes.ux * rest.x * body.width * horizontalScale
        + axes.vx * rest.y * body.height * verticalScale;
      const targetY = center.y
        + axes.uy * rest.x * body.width * horizontalScale
        + axes.vy * rest.y * body.height * verticalScale;
      const point = body.particles[index + 1];
      point.x += (targetX - point.x) * strength;
      point.y += (targetY - point.y) * strength;
    }
  }

  startElasticShape(body, amplitude) {
    const safeAmplitude = clamp(amplitude, -0.5, 1.15);
    if (body.elasticShape) {
      body.elasticShape.value = clamp(body.elasticShape.value + safeAmplitude, -0.55, 1.25);
      body.elasticShape.velocity *= 0.35;
      body.elasticShape.age = 0;
      return;
    }
    body.elasticShape = { value: safeAmplitude, velocity: 0, age: 0 };
  }

  applyLandingResponse(body, intensity, role = "lander") {
    const roleScale = role === "support" ? 0.62 : 1;
    const power = clamp(intensity, 0.2, 1) * roleScale;
    this.startElasticShape(body, 0.74 * power);
    for (let index = 0; index < REST_RING.length; index += 1) {
      const rest = REST_RING[index];
      const point = body.particles[index + 1];
      const sideWeight = Math.abs(rest.x) / 0.52;
      const lowerWeight = clamp((rest.y + 0.08) / 0.59, 0, 1);
      const outward = Math.sign(rest.x) * sideWeight * 1.05 * power;
      const lift = (0.24 + (1 - lowerWeight) * 0.48) * power;
      point.px -= outward;
      point.py += lift;
    }
    const center = body.particles[0];
    center.py += 0.42 * power;
  }

  findSupportingBody(body) {
    const bounds = bodyAabb(body);
    let best = null;
    let bestScore = Infinity;
    for (const candidate of this.bodies) {
      if (candidate === body) continue;
      if (candidate.particles[0].y <= body.particles[0].y + body.height * 0.28) continue;
      const candidateBounds = bodyAabb(candidate);
      const horizontalOverlap = Math.min(bounds.maxX, candidateBounds.maxX)
        - Math.max(bounds.minX, candidateBounds.minX);
      const minimumOverlap = Math.min(body.width, candidate.width)
        * MOTION_TUNING.supportMinimumOverlapFactor;
      if (horizontalOverlap < minimumOverlap) continue;
      const verticalGap = candidateBounds.minY - bounds.maxY;
      const knownContact = body.contactBodyIds.has(candidate.id);
      if (!knownContact
        && (verticalGap < -body.height * 0.2 || verticalGap > MOTION_TUNING.supportMaximumGap)) continue;
      const score = Math.abs(verticalGap) + Math.abs(candidate.particles[0].x - body.particles[0].x) * 0.01;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  hasNearbyCompanion(body) {
    return this.bodies.some((candidate) => {
      if (candidate === body) return false;
      const horizontalRange = (body.width + candidate.width) * MOTION_TUNING.nearbyHorizontalFactor;
      const verticalRange = (body.height + candidate.height) * MOTION_TUNING.nearbyVerticalFactor;
      return Math.abs(candidate.particles[0].x - body.particles[0].x) <= horizontalRange
        && Math.abs(candidate.particles[0].y - body.particles[0].y) <= verticalRange;
    });
  }

  solvePokeDeformation(body) {
    const deformation = body.pokeDeformation;
    if (!deformation) return;
    const progress = (this.time - deformation.startedAt) / deformation.duration;
    if (progress >= 1) {
      const center = body.particles[0];
      for (const entry of deformation.points) {
        const point = body.particles[entry.index];
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const length = Math.hypot(dx, dy);
        if (length < EPSILON) continue;
        const kick = clamp(entry.indentation * 0.38, 0.7, 5.2);
        point.px -= dx / length * kick;
        point.py -= dy / length * kick;
      }
      body.pokeDeformation = null;
      return;
    }
    const releaseProgress = clamp((progress - 0.12) / 0.88, 0, 1);
    const smoothRelease = releaseProgress * releaseProgress * (3 - 2 * releaseProgress);
    const envelope = 1 - smoothRelease;
    const center = body.particles[0];
    for (const entry of deformation.points) {
      const point = body.particles[entry.index];
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const length = Math.hypot(dx, dy);
      if (length < EPSILON) continue;
      const targetLength = entry.restRadius - entry.indentation * envelope;
      const excess = length - targetLength;
      if (excess <= 0) continue;
      const correction = excess * 0.62;
      point.x -= dx / length * correction;
      point.y -= dy / length * correction;
    }
  }

  solveBounds(body, dt) {
    const floor = this.floorY;
    const left = this.config.wallPadding;
    const right = this.width - this.config.wallPadding;
    for (let index = 0; index < body.particles.length; index += 1) {
      const point = body.particles[index];
      if (point.y > floor) {
        const vx = point.x - point.px;
        const vy = point.y - point.py;
        body.impactSpeed = Math.max(body.impactSpeed, Math.max(0, vy / dt));
        point.y = floor;
        if (point.floorStep !== this.stepCount) {
          point.py = floor + Math.max(0, vy) * this.config.restitution;
          point.px = point.x - vx * this.config.floorFriction;
          point.floorStep = this.stepCount;
        }
        body.contactCount += 1;
      }

      if (point.x < left || point.x > right) {
        const boundary = point.x < left ? left : right;
        const vx = point.x - point.px;
        point.x = boundary;
        if (point.wallStep !== this.stepCount) {
          point.px = boundary + vx * 0.08;
          point.wallStep = this.stepCount;
        }
      }
      if (point.y < 2) {
        const vy = point.y - point.py;
        point.y = 2;
        point.py = 2 + vy * 0.04;
      }
    }
  }

  solveBodyCollisions() {
    const verticalBias = this.bodies.length >= 6 ? 0.12 : this.bodies.length >= 5 ? 0.42 : 1;
    const activePairs = new Set();
    for (let aIndex = 0; aIndex < this.bodies.length; aIndex += 1) {
      const a = this.bodies[aIndex];
      for (let bIndex = aIndex + 1; bIndex < this.bodies.length; bIndex += 1) {
        const b = this.bodies[bIndex];
        const aabbA = bodyAabb(a);
        const aabbB = bodyAabb(b);
        if (!overlaps(aabbA, aabbB, this.config.contactSkin)) continue;
        const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        const previous = this.contactNormals.get(pairKey);
        let preferred = previous
          ? (a.id < b.id ? previous : { nx: -previous.nx, ny: -previous.ny })
          : null;
        if (!preferred) {
          const dragA = this.bodyDrags(a).length === 1 ? this.bodyDrags(a)[0] : null;
          const dragB = this.bodyDrags(b).length === 1 ? this.bodyDrags(b)[0] : null;
          const initialA = dragA
            ? { x: dragA.startX + dragA.offsetX, y: dragA.startY + dragA.offsetY }
            : a.particles[0];
          const initialB = dragB
            ? { x: dragB.startX + dragB.offsetX, y: dragB.startY + dragB.offsetY }
            : b.particles[0];
          const hintX = initialB.x - initialA.x;
          const hintY = initialB.y - initialA.y;
          const hintLength = Math.hypot(hintX, hintY);
          if (hintLength > EPSILON) preferred = { nx: hintX / hintLength, ny: hintY / hintLength };
        }
        const collision = satCollision(a, b, verticalBias, preferred);
        if (!collision) continue;
        activePairs.add(pairKey);
        const stored = a.id < b.id
          ? { nx: collision.nx, ny: collision.ny }
          : { nx: -collision.nx, ny: -collision.ny };
        this.contactNormals.set(pairKey, { ...stored, seenAt: this.stepCount });
        this.solveSatContact(a, b, collision);
      }
    }
    for (const [pairKey, state] of this.contactNormals) {
      if (!activePairs.has(pairKey) && this.stepCount - state.seenAt > 2) this.contactNormals.delete(pairKey);
    }
  }

  solveSatContact(bodyA, bodyB, collision) {
    const ringA = bodyRing(bodyA);
    const ringB = bodyRing(bodyB);
    const projectionsA = ringA.map((point) => point.x * collision.nx + point.y * collision.ny);
    const projectionsB = ringB.map((point) => point.x * collision.nx + point.y * collision.ny);
    const supportA = Math.max(...projectionsA);
    const supportB = Math.min(...projectionsB);
    const band = Math.max(5, Math.min(14, collision.overlap + 4));
    const contactsA = ringA.filter((point, index) => supportA - projectionsA[index] <= band);
    const contactsB = ringB.filter((point, index) => projectionsB[index] - supportB <= band);
    if (contactsA.length === 0 || contactsB.length === 0) return;

    const mobilityA = bodyA.dragPointer === null ? 1 : 0.18;
    const mobilityB = bodyB.dragPointer === null ? 1 : 0.18;
    const totalMobility = mobilityA + mobilityB;
    const response = clamp(this.contactResponse(bodyA, bodyB), 0.005, 1);
    const depth = Math.min(collision.overlap + this.config.contactSkin, 12) * 0.58 * response;
    const moveA = depth * mobilityA / totalMobility;
    const moveB = depth * mobilityB / totalMobility;
    const tangentX = -collision.ny;
    const tangentY = collision.nx;

    const translateBody = (body, direction, amount) => {
      if (amount <= 0) return;
      const dx = collision.nx * amount * direction;
      const dy = collision.ny * amount * direction;
      for (const point of body.particles) translateParticle(point, dx, dy, true);
    };

    // Move a little of the whole mass as well as deforming the contact patch.
    // The centre-gap guard only engages under deep penetration, leaving normal
    // stacking soft while ensuring a held body cannot tunnel or reverse order.
    const bulkDepth = Math.max(0, collision.overlap - this.config.contactSkin * 2) * 0.22 * response;
    translateBody(bodyA, -1, bulkDepth * mobilityA / totalMobility);
    translateBody(bodyB, 1, bulkDepth * mobilityB / totalMobility);
    const centerA = bodyA.particles[0];
    const centerB = bodyB.particles[0];
    const centerSeparation = (centerB.x - centerA.x) * collision.nx
      + (centerB.y - centerA.y) * collision.ny;
    const minimumCenterGap = 0.18 * (
      Math.abs(collision.nx) * (bodyA.width + bodyB.width)
      + Math.abs(collision.ny) * (bodyA.height + bodyB.height)
    );
    const orderCorrection = Math.max(0, minimumCenterGap - centerSeparation) * response;
    translateBody(bodyA, -1, orderCorrection * mobilityA / totalMobility);
    translateBody(bodyB, 1, orderCorrection * mobilityB / totalMobility);

    const moveContacts = (contacts, direction, amount) => {
      for (const point of contacts) {
        const dx = collision.nx * amount * direction;
        const dy = collision.ny * amount * direction;
        point.x += dx;
        point.y += dy;
        point.px += dx * 0.96;
        point.py += dy * 0.96;
        const velocityX = point.x - point.px;
        const velocityY = point.y - point.py;
        const tangentVelocity = velocityX * tangentX + velocityY * tangentY;
        point.px += tangentX * tangentVelocity * 0.18;
        point.py += tangentY * tangentVelocity * 0.18;
      }
    };
    moveContacts(contactsA, -1, moveA);
    moveContacts(contactsB, 1, moveB);
    bodyA.contactBodyIds.add(bodyB.id);
    bodyB.contactBodyIds.add(bodyA.id);
    bodyA.contactCount += contactsA.length;
    bodyB.contactCount += contactsB.length;
  }

  contactResponse() {
    return 1;
  }

  finishContacts() {
    const states = this.bodies.map((body) => ({
      body,
      grounded: bodyRing(body).some((point) => point.y >= this.floorY - 0.75),
      support: this.findSupportingBody(body),
    }));

    for (const state of states) {
      const { body } = state;
      const center = body.particles[0];
      if (body.dragPointer !== null) {
        body.isGrounded = false;
        body.isSupported = false;
        body.supportBodyId = null;
        body.airborneSteps = 0;
        body.airborneStartY = center.y;
        body.fallDistance = 0;
        body.maximumFallSpeed = 0;
        body.isScared = false;
        continue;
      }

      const supportedNow = state.grounded || Boolean(state.support);
      if (!supportedNow) {
        if (body.isSupported || body.airborneSteps === 0) {
          body.airborneStartY = center.y;
          body.fallDistance = 0;
          body.maximumFallSpeed = 0;
        }
        body.airborneSteps += 1;
        body.fallDistance = Math.max(body.fallDistance, center.y - body.airborneStartY);
        body.maximumFallSpeed = Math.max(body.maximumFallSpeed, body.stepVelocityY);
        const eekDistance = Math.max(
          MOTION_TUNING.highFallMinimumDistance * 0.72,
          body.height * MOTION_TUNING.highFallDistanceFactor * 0.72,
        );
        if (body.airborneSteps >= 6
          && body.fallDistance >= eekDistance
          && body.maximumFallSpeed >= MOTION_TUNING.highFallSpeed * 0.8) {
          body.isScared = true;
        }
      } else {
        const landedNow = !body.isSupported
          && body.airborneSteps >= MOTION_TUNING.minimumLandingSteps;
        const impactSpeed = Math.max(
          body.impactSpeed,
          body.maximumFallSpeed,
          body.stepVelocityY,
        );
        const highFallDistance = Math.max(
          MOTION_TUNING.highFallMinimumDistance,
          body.height * MOTION_TUNING.highFallDistanceFactor,
        );
        const highFall = body.airborneSteps >= MOTION_TUNING.highFallMinimumSteps
          && body.fallDistance >= highFallDistance
          && body.maximumFallSpeed >= MOTION_TUNING.highFallSpeed;

        if (landedNow
          && impactSpeed >= MOTION_TUNING.minimumLandingSpeed
          && this.time - body.lastImpactAt > MOTION_TUNING.landingCooldown) {
          body.lastImpactAt = this.time;
          const intensity = clamp(impactSpeed / 630, 0.24, 1);
          this.applyLandingResponse(body, intensity, "lander");
          this.setExpression(body, "surprised", 0.24, "sly", 0.58);

          if (state.support) {
            this.applyLandingResponse(state.support, intensity, "support");
            state.support.sadLanding = null;
            state.support.isScared = false;
            this.setExpression(state.support, "surprised", 0.16, "sly", 0.46);
          }

          const aloneOnFloor = highFall
            && state.grounded
            && !state.support
            && !this.hasNearbyCompanion(body);
          if (aloneOnFloor) {
            body.sadLanding = {
              startAt: this.time + 0.18,
              endAt: this.time + 0.74,
            };
            body.landingStabilizer = {
              anchorX: center.x,
              endAt: this.time + 1.05,
            };
            this.events.push({ type: "solo-sad", bodyId: body.id, time: this.time + 0.18 });
          } else {
            body.sadLanding = null;
            body.landingStabilizer = null;
          }

          this.events.push({
            type: "landed",
            bodyId: body.id,
            intensity,
            highFall,
            supportBodyId: state.support?.id ?? null,
            time: this.time,
          });
        }

        body.airborneSteps = 0;
        body.airborneStartY = center.y;
        body.fallDistance = 0;
        body.maximumFallSpeed = 0;
        body.isScared = false;
      }

      body.isGrounded = state.grounded;
      body.isSupported = supportedNow;
      body.supportBodyId = state.support?.id ?? null;
    }
  }

  recoverInvalidBodies() {
    for (let bodyIndex = 0; bodyIndex < this.bodies.length; bodyIndex += 1) {
      const body = this.bodies[bodyIndex];
      if (body.particles.every(isFiniteParticle)) continue;
      const x = clamp(this.width * 0.5 + (bodyIndex - 2) * 8, body.width, this.width - body.width);
      const y = Math.max(body.height, 56 + bodyIndex * 8);
      const replacement = createBody(body.id, x, y, body.width, body.height, body.variant, body.createdAt);
      this.bodies[bodyIndex] = replacement;
      this.events.push({ type: "recovered", bodyId: body.id, time: this.time });
    }
  }

  consumeEvents() {
    const current = this.events;
    this.events = [];
    return current;
  }

  snapshot() {
    return {
      time: this.time,
      width: this.width,
      height: this.height,
      floorY: this.floorY,
      paused: this.paused,
      stopped: this.stopped,
      activeDrags: this.drags.size,
      bodies: this.bodies.map((body) => ({
        id: body.id,
        center: { x: body.particles[0].x, y: body.particles[0].y },
        area: polygonArea(bodyRing(body)),
        restArea: body.restArea,
        bounds: bodyAabb(body),
        contactCount: body.contactCount,
        isGrounded: body.isGrounded,
        isSupported: body.isSupported,
        supportBodyId: body.supportBodyId,
        fallDistance: body.fallDistance,
        maximumFallSpeed: body.maximumFallSpeed,
        elasticValue: body.elasticShape?.value ?? 0,
        sadLandingActive: Boolean(body.sadLanding),
        gestureStretch: body.gestureStretch,
        gestureSurprise: body.gestureSurprise,
        gesturePout: body.gesturePout,
        actualStretch: body.actualStretch,
        isStretchCrying: body.isStretchCrying,
        releaseSpeed: body.gestureReleaseSpeed,
        expression: this.expressionFor(body),
        particles: body.particles.map((point) => ({ x: point.x, y: point.y, px: point.px, py: point.py })),
      })),
    };
  }
}

export const physicsMath = Object.freeze({
  clamp,
  polygonArea,
  pointInPolygon,
  bodyAabb,
  satCollision,
});

import { SoftBodyWorld, physicsMath } from "./physics.js?v=20261006-goals2";

export const PUDDING_COLORS = Object.freeze([
  Object.freeze({ id: "custard", name: "カスタード", tint: "#ffd768", accent: "#fff2a6" }),
  Object.freeze({ id: "berry", name: "いちご", tint: "#f3a0b2", accent: "#ffd3dc" }),
  Object.freeze({ id: "matcha", name: "抹茶", tint: "#9ecb78", accent: "#dff0b8" }),
]);

export const PUDDING_TIERS = Object.freeze([
  Object.freeze({ id: "petit", name: "ぷち", width: 84, height: 66, decoration: 0 }),
  Object.freeze({ id: "cream", name: "クリーム", width: 108, height: 84, decoration: 1 }),
  Object.freeze({ id: "cherry", name: "さくらんぼ", width: 134, height: 104, decoration: 2 }),
]);

export const MERGE_RULES = Object.freeze({
  holdDuration: 0.48,
  deepPressThreshold: 0.28,
  releaseRecovery: 0.16,
  splitStretch: 1.43,
  splitHoldDuration: 0.22,
  splitMergeLock: 0.9,
});

export const GOAL_RULES = Object.freeze({ collectionInterval: 0.42, flightDuration: 0.68 });

const clamp = physicsMath.clamp;

function pairKey(a, b) {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

function bodyVelocity(body) {
  const center = body.particles[0];
  return { x: center.x - center.px, y: center.y - center.py };
}

function paddedOverlap(a, b, padding = 0) {
  const aa = physicsMath.bodyAabb(a);
  const bb = physicsMath.bodyAabb(b);
  return aa.minX <= bb.maxX + padding
    && aa.maxX + padding >= bb.minX
    && aa.minY <= bb.maxY + padding
    && aa.maxY + padding >= bb.minY;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export class MergePuddingWorld extends SoftBodyWorld {
  constructor(options = {}) {
    const hardMaxBodies = options.maxBodies ?? 16;
    super({ ...options, maxBodies: hardMaxBodies });
    this.addLimit = clamp(options.addLimit ?? Math.min(12, hardMaxBodies), 1, hardMaxBodies);
    this.fusionPairs = new Map();
    this.sparkles = [];
    this.nextRenderOrder = 1;
    this.addColorCursor = 0;
    this.dropRandomState = (options.dropSeed ?? 0x9e3779b9) >>> 0;
    this.nextDropColorIndex = this.rollDropColor();
    this.goal = null;
    this.goalQueue = [];
    this.goalVersion = 0;
    this.goalProgress = 0;
    this.goalRandomState = (options.goalSeed ?? 0x51f15e) >>> 0;
    this.goalScript = [...(options.goalSequence ?? [])];
    this.goalCollections = [];
    this.goalAnchor = { x: this.width - 62, y: 58 };
    this.nextGoalCheckAt = 0;
    this.goalChainOpen = false;
    this.goalChainDeadline = 0;
    this.comboCount = 0;
    this.comboVisibleUntil = 0;
    this.comboPulseAt = -Infinity;
    this.goalChainGraceUntil = 0;
    this.mode = "unlimited";
    this.timeLimit = 120;
    this.timeRemaining = Infinity;
    this.runEnded = false;
    this.deliveredCount = 0;
    this.highestCombo = 0;
  }

  addPudding(options = {}) {
    const tier = clamp(Math.round(options.tier ?? 0), 0, PUDDING_TIERS.length - 1);
    const colorIndex = clamp(
      Math.round(options.colorIndex ?? this.addColorCursor),
      0,
      PUDDING_COLORS.length - 1,
    );
    const tierSpec = PUDDING_TIERS[tier];
    const body = super.addPudding({
      ...options,
      width: options.width ?? tierSpec.width,
      height: options.height ?? tierSpec.height,
      variant: colorIndex,
    });
    if (!body) return null;
    Object.assign(body, {
      tier,
      colorIndex,
      renderOrder: this.nextRenderOrder,
      fusionProgress: 0,
      splitProgress: 0,
      noMergeUntil: options.noMergeUntil ?? 0,
      mergeBirthAt: options.mergeBirthAt ?? -Infinity,
      splitBirthAt: options.splitBirthAt ?? -Infinity,
      lastInteractionAt: this.time,
      idleSleepAt: this.time + 3.8 + (body.id % 3) * 0.55,
      idleState: "neutral",
      idleGazeTargetId: null,
      mergeGazeTargetId: null,
      delayedStartleAt: null,
      idleReactionCooldownUntil: 0,
      goalReadyAt: options.goalReadyAt ?? this.time + (tier === PUDDING_TIERS.length - 1 ? 0.95 : 0.38),
      goalCollecting: false,
    });
    this.nextRenderOrder += 1;
    this.addColorCursor = (colorIndex + 1) % PUDDING_COLORS.length;
    return body;
  }

  rollDropColor() {
    this.dropRandomState = (Math.imul(this.dropRandomState, 1103515245) + 12345) >>> 0;
    return Math.floor((this.dropRandomState / 4294967296) * PUDDING_COLORS.length);
  }

  addNextDrop(options = {}) {
    if (this.bodies.length >= this.addLimit) return null;
    const colorIndex = this.nextDropColorIndex;
    const body = this.addPudding({ ...options, tier: 0, colorIndex });
    if (body) this.nextDropColorIndex = this.rollDropColor();
    return body;
  }

  removeAll() {
    super.removeAll();
    this.fusionPairs?.clear();
    if (this.sparkles) this.sparkles.length = 0;
    this.goal = null;
    this.goalQueue = [];
    this.goalCollections = [];
    this.goalChainOpen = false;
    this.goalProgress = 0;
    this.comboCount = 0;
    this.comboVisibleUntil = 0;
    this.goalChainGraceUntil = 0;
  }

  reset(count = 3) {
    this.removeAll();
    const total = clamp(Math.round(count), 0, Math.min(6, this.config.maxBodies));
    const baseWidth = PUDDING_TIERS[0].width;
    const spacing = total > 1
      ? Math.min(baseWidth * 1.12, (this.width - baseWidth * 1.2) / (total - 1))
      : 0;
    for (let index = 0; index < total; index += 1) {
      this.addPudding({
        tier: 0,
        colorIndex: index % PUDDING_COLORS.length,
        x: this.width * 0.5 + (index - (total - 1) * 0.5) * spacing,
        y: Math.max(58, this.floorY - 154 - (index % 2) * 24),
        vx: (index - (total - 1) * 0.5) * 8,
      });
    }
    this.resetGoalQueue({ avoidExisting: true });
  }

  beginDrag(pointerId, x, y, options = {}) {
    const body = super.beginDrag(pointerId, x, y, options);
    if (body && this.bodyDrags(body).length === 1) {
      body.renderOrder = this.nextRenderOrder;
      this.nextRenderOrder += 1;
    }
    if (body) {
      this.wakeBody(body, false);
      const drag = this.drags.get(pointerId);
      const center = body.particles[0];
      drag.orderConstraints = this.bodies
        .filter((candidate) => candidate !== body)
        .map((candidate) => {
          const dx = candidate.particles[0].x - center.x;
          const dy = candidate.particles[0].y - center.y;
          const length = Math.max(0.001, Math.hypot(dx, dy));
          return {
            bodyId: candidate.id,
            nx: dx / length,
            ny: dy / length,
            anchorX: candidate.particles[0].x,
            anchorY: candidate.particles[0].y,
          };
        });
    }
    return body;
  }

  moveDrag(pointerId, x, y, options = {}) {
    const drag = this.drags.get(pointerId);
    if (drag) this.wakeBody(drag.body, false);
    return super.moveDrag(pointerId, x, y, options);
  }

  poke(bodyOrId, x, y, strength = 1) {
    const body = this.getBody(bodyOrId) ?? this.hitTest(x, y);
    if (body) this.wakeBody(body, false);
    return super.poke(body, x, y, strength);
  }

  pairCanFuse(a, b) {
    if (a.tier !== b.tier) return false;
    const maximumPair = a.tier === PUDDING_TIERS.length - 1;
    if (!maximumPair && a.colorIndex !== b.colorIndex) return false;
    return this.time >= a.noMergeUntil && this.time >= b.noMergeUntil;
  }

  constrainDragTarget(drag, target, gripOffset) {
    let x = target.x;
    let y = target.y;
    for (const constraint of drag.orderConstraints ?? []) {
      const other = this.getBody(constraint.bodyId);
      if (!other || this.pairCanFuse(drag.body, other)) continue;
      const desiredCenterX = x - gripOffset.x;
      const desiredCenterY = y - gripOffset.y;
      const separation = (constraint.anchorX - desiredCenterX) * constraint.nx
        + (constraint.anchorY - desiredCenterY) * constraint.ny;
      const minimumGap = 0.2 * (
        Math.abs(constraint.nx) * (drag.body.width + other.width)
        + Math.abs(constraint.ny) * (drag.body.height + other.height)
      );
      if (separation >= minimumGap) continue;
      const correction = minimumGap - separation;
      x -= constraint.nx * correction;
      y -= constraint.ny * correction;
    }
    return { x, y };
  }

  step(dt = 1 / 60) {
    if (this.runEnded) return;
    if (!this.paused && !this.stopped && this.bodies.length === 0
      && (this.sparkles.length > 0 || this.goalCollections.length > 0
        || this.goalChainOpen || this.mode === "timed")) {
      const elapsed = clamp(dt, 1 / 240, 1 / 25);
      this.time += elapsed;
      this.stepCount += 1;
      this.updateSparkles(elapsed);
      this.updateGoalSystem();
      this.advanceModeClock(elapsed);
      return;
    }
    const before = this.time;
    const eventStart = this.events.length;
    super.step(dt);
    const elapsed = this.time - before;
    if (elapsed <= 0) return;
    const stepEvents = this.events.slice(eventStart);
    this.updateSparkles(elapsed);
    this.updateIdleLife(elapsed, stepEvents);
    this.updateSplits(elapsed);
    this.updateFusion(elapsed);
    this.updateGoalSystem();
    this.advanceModeClock(elapsed);
  }

  startTimedMode(seconds = 120) {
    this.mode = "timed";
    this.timeLimit = Math.max(10, Number(seconds) || 120);
    this.timeRemaining = this.timeLimit;
    this.runEnded = false;
    this.deliveredCount = 0;
    this.highestCombo = 0;
    this.setPaused(false);
    this.reset(3);
    this.events.push({ type: "timed-start", seconds: this.timeLimit, time: this.time });
  }

  startUnlimitedMode() {
    this.mode = "unlimited";
    this.timeRemaining = Infinity;
    this.runEnded = false;
    this.deliveredCount = 0;
    this.highestCombo = 0;
    this.setPaused(false);
    this.reset(3);
    this.events.push({ type: "unlimited-start", time: this.time });
  }

  advanceModeClock(dt) {
    if (this.mode !== "timed" || this.runEnded) return;
    this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    if (this.timeRemaining > 0) return;
    this.runEnded = true;
    this.cancelAllDrags();
    this.events.push({
      type: "time-ended",
      delivered: this.deliveredCount,
      highestCombo: this.highestCombo,
      time: this.time,
    });
  }

  setGoalAnchor(x, y) {
    if (Number.isFinite(x) && Number.isFinite(y)) this.goalAnchor = { x, y };
  }

  nextGoalRandom() {
    this.goalRandomState = (Math.imul(this.goalRandomState, 1664525) + 1013904223) >>> 0;
    return this.goalRandomState / 4294967296;
  }

  goalMatches(body, goal = this.goal) {
    return Boolean(goal) && body.colorIndex === goal.colorIndex && body.tier === goal.tier;
  }

  makeGoal(options = {}) {
    const previous = options.previous ?? this.goalQueue.at(-1) ?? this.goal;
    let chosen = null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const scripted = this.goalScript.length > 0 ? this.goalScript.shift() : null;
      const candidate = scripted ?? {
        colorIndex: Math.floor(this.nextGoalRandom() * PUDDING_COLORS.length),
        tier: Math.floor(this.nextGoalRandom() * PUDDING_TIERS.length),
      };
      const normalized = {
        colorIndex: clamp(Math.round(candidate.colorIndex ?? 0), 0, PUDDING_COLORS.length - 1),
        tier: clamp(Math.round(candidate.tier ?? 0), 0, PUDDING_TIERS.length - 1),
      };
      const repeats = previous
        && normalized.colorIndex === previous.colorIndex
        && normalized.tier === previous.tier;
      const exists = this.bodies.some((body) => this.goalMatches(body, normalized));
      if ((!options.avoidExisting || !exists) && (!repeats || attempt > 10)) {
        chosen = normalized;
        break;
      }
      chosen = normalized;
    }
    const normalized = chosen ?? { colorIndex: 0, tier: 1 };
    this.goalVersion += 1;
    return { ...normalized, version: this.goalVersion };
  }

  syncCurrentGoal(options = {}) {
    this.goal = this.goalQueue[0] ?? null;
    this.nextGoalCheckAt = options.checkAt ?? this.time + (options.immediate ? 0 : 0.08);
    if (this.goal) {
      this.events.push({
        type: "goal-changed",
        ...this.goal,
        queue: this.goalQueue.map((goal) => ({ ...goal })),
        time: this.time,
      });
    }
    return this.goal;
  }

  setGoalQueue(goals, options = {}) {
    this.goalQueue = goals.slice(0, 3).map((goal) => {
      this.goalVersion += 1;
      return {
        colorIndex: clamp(Math.round(goal.colorIndex ?? 0), 0, PUDDING_COLORS.length - 1),
        tier: clamp(Math.round(goal.tier ?? 0), 0, PUDDING_TIERS.length - 1),
        version: this.goalVersion,
      };
    });
    while (this.goalQueue.length < 3) {
      this.goalQueue.push(this.makeGoal({
        avoidExisting: options.avoidExisting && this.goalQueue.length === 0,
        previous: this.goalQueue.at(-1),
      }));
    }
    return this.syncCurrentGoal(options);
  }

  setGoal(goal, options = {}) {
    return this.setGoalQueue([goal], options);
  }

  resetGoalQueue(options = {}) {
    this.goalQueue = [];
    while (this.goalQueue.length < 3) {
      this.goalQueue.push(this.makeGoal({
        avoidExisting: options.avoidExisting && this.goalQueue.length === 0,
        previous: this.goalQueue.at(-1),
      }));
    }
    return this.syncCurrentGoal({ immediate: false });
  }

  advanceGoalQueue() {
    this.goalQueue.shift();
    this.goalQueue.push(this.makeGoal({ previous: this.goalQueue.at(-1) }));
    return this.syncCurrentGoal({ immediate: false });
  }

  goalEligible(body) {
    return !body.goalCollecting
      && body.dragPointer === null
      && this.bodyDrags(body).length === 0
      && body.fusionProgress < 0.02
      && body.splitProgress < 0.18
      && this.time >= body.goalReadyAt
      && this.time - body.mergeBirthAt > 0.34
      && this.time - body.splitBirthAt > 0.34;
  }

  startGoalCollection(body) {
    // Recheck at the mutation boundary: selection and collection must never
    // disagree about the colour/tier, membership, or one-at-a-time cadence.
    if (!body || !this.bodies.includes(body) || !this.goalMatches(body)
      || !this.goalEligible(body) || this.time < this.nextGoalCheckAt) return false;
    const collectedGoal = { ...this.goal };
    const continuesCombo = this.goalChainOpen;
    if (!continuesCombo) {
      this.comboCount = 0;
      this.comboVisibleUntil = 0;
    }
    body.goalCollecting = true;
    body.mergeGazeTargetId = null;
    body.idleGazeTargetId = null;
    body.idleState = "neutral";
    super.setExpression(body, "eek", 0.7);
    this.removeBodies([body]);
    const collection = {
      body,
      bodyId: body.id,
      goal: collectedGoal,
      startedAt: this.time,
      duration: GOAL_RULES.flightDuration,
      comboIndex: continuesCombo ? this.comboCount + 1 : 1,
      turn: body.id % 2 === 0 ? -1 : 1,
    };
    this.goalCollections.push(collection);
    this.comboCount = collection.comboIndex;
    this.highestCombo = Math.max(this.highestCombo, this.comboCount);
    this.deliveredCount += 1;
    this.goalProgress += 1;
    this.comboVisibleUntil = this.time + 1.45;
    this.comboPulseAt = this.time;
    this.goalChainOpen = true;
    this.goalChainGraceUntil = 0;
    this.events.push({
      type: "goal-collection-start",
      bodyId: body.id,
      colorIndex: body.colorIndex,
      tier: body.tier,
      goalVersion: collectedGoal.version,
      combo: this.comboCount,
      time: this.time,
    });
    this.events.push({
      type: "goal-collected",
      bodyId: body.id,
      colorIndex: collectedGoal.colorIndex,
      tier: collectedGoal.tier,
      goalVersion: collectedGoal.version,
      combo: this.comboCount,
      time: this.time,
    });
    this.advanceGoalQueue();
    this.nextGoalCheckAt = this.time + GOAL_RULES.collectionInterval;
    return true;
  }

  updateGoalSystem() {
    if (!this.goal) return;
    const finished = [];
    this.goalCollections = this.goalCollections.filter((collection) => {
      if (this.time - collection.startedAt < collection.duration) return true;
      finished.push(collection);
      return false;
    });
    for (const collection of finished) {
      this.events.push({ type: "goal-flight-finished", bodyId: collection.bodyId, time: this.time });
    }
    if (this.time < this.nextGoalCheckAt) return;
    const candidate = this.bodies
      .filter((body) => this.goalMatches(body) && this.goalEligible(body))
      .sort((a, b) => (a.renderOrder ?? a.id) - (b.renderOrder ?? b.id))[0];
    if (candidate) {
      this.startGoalCollection(candidate);
      return;
    }
    if (!this.goalChainOpen) return;
    const hasMatchingBody = this.bodies.some((body) => this.goalMatches(body));
    if (this.goalCollections.length > 0 || hasMatchingBody) {
      this.goalChainGraceUntil = 0;
      return;
    }
    if (this.goalChainGraceUntil === 0) this.goalChainGraceUntil = this.time + 0.32;
    if (this.time >= this.goalChainGraceUntil) {
      this.goalChainOpen = false;
      this.goalChainGraceUntil = 0;
    }
  }

  wakeBody(body, startled = false) {
    body.lastInteractionAt = this.time;
    body.idleSleepAt = this.time + 4.2 + (body.id % 3) * 0.55;
    body.idleState = "neutral";
    body.idleGazeTargetId = null;
    body.delayedStartleAt = null;
    if (startled) super.setExpression(body, "eek", 0.2, "surprised", 0.2);
  }

  nearestIdleCompanion(body, maximumDistance = 250) {
    let best = null;
    let bestDistance = maximumDistance;
    for (const candidate of this.bodies) {
      if (candidate === body) continue;
      const distance = Math.hypot(
        candidate.particles[0].x - body.particles[0].x,
        candidate.particles[0].y - body.particles[0].y,
      );
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  updateIdleLife(_dt, stepEvents) {
    const landings = stepEvents.filter((event) => event.type === "landed");
    for (const body of this.bodies) {
      if (body.dragPointer !== null || body.isStretchCrying || body.fusionProgress > 0.02) {
        body.idleState = "neutral";
        body.idleGazeTargetId = null;
        body.delayedStartleAt = null;
        continue;
      }

      if (body.delayedStartleAt !== null && this.time >= body.delayedStartleAt) {
        body.delayedStartleAt = null;
        body.idleReactionCooldownUntil = this.time + 1.1;
        super.setExpression(body, "eek", 0.18, "surprised", 0.24);
      }

      const quietExpression = super.expressionFor(body) === "neutral";
      if (body.colorIndex === 0) {
        if (quietExpression && this.time >= body.idleSleepAt) body.idleState = "sleep";
      } else if (body.colorIndex === 1) {
        body.idleState = "watch";
        body.idleGazeTargetId = this.nearestIdleCompanion(body, body.width * 3.2)?.id ?? null;
      } else {
        body.idleState = "calm";
      }

      if (this.time < body.idleReactionCooldownUntil) continue;
      const nearbyLanding = landings.find((event) => {
        if (event.bodyId === body.id) return false;
        const source = this.getBody(event.bodyId);
        if (!source) return false;
        return Math.hypot(
          source.particles[0].x - body.particles[0].x,
          source.particles[0].y - body.particles[0].y,
        ) <= Math.max(225, body.width * 2.5);
      });
      if (!nearbyLanding) continue;

      if (body.colorIndex === 0 && body.idleState === "sleep") {
        this.wakeBody(body, true);
        body.idleReactionCooldownUntil = this.time + 1.2;
      } else if (body.colorIndex === 1 && (body.isGrounded || body.isSupported)) {
        for (const point of body.particles) point.py += 1.15;
        this.startElasticShape(body, -0.12);
        super.setExpression(body, "surprised", 0.25, "sly", 0.24);
        body.idleReactionCooldownUntil = this.time + 1.25;
      } else if (body.colorIndex === 2) {
        body.delayedStartleAt = this.time + 0.24;
        body.idleReactionCooldownUntil = this.time + 1.4;
      }
    }
  }

  expressionFor(bodyOrId) {
    const body = this.getBody(bodyOrId);
    if (!body) return "neutral";
    const priority = super.expressionFor(body);
    if (priority !== "neutral") return priority;
    if (body.idleState === "sleep") return "sleep";
    return "neutral";
  }

  faceStateFor(bodyOrId) {
    const body = this.getBody(bodyOrId);
    if (!body) return { expression: "neutral", surprise: 0, pout: 0, gazeX: 0, gazeY: 0 };
    const targetId = body.mergeGazeTargetId ?? body.idleGazeTargetId;
    const target = targetId === null ? null : this.getBody(targetId);
    let gazeX = 0;
    let gazeY = 0;
    if (target && !body.isStretchCrying
      && (body.mergeGazeTargetId !== null || body.dragPointer === null)) {
      const dx = target.particles[0].x - body.particles[0].x;
      const dy = target.particles[0].y - body.particles[0].y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const strength = body.mergeGazeTargetId === null ? 0.68 : 1;
      gazeX = dx / length * strength;
      gazeY = dy / length * strength;
    }
    return {
      expression: this.expressionFor(body),
      surprise: Math.max(body.gestureSurprise ?? 0, (body.fusionProgress ?? 0) * 0.24),
      pout: body.gesturePout ?? 0,
      gazeX,
      gazeY,
    };
  }

  updateSparkles(dt) {
    for (const sparkle of this.sparkles) {
      sparkle.age += dt;
      sparkle.vx *= Math.exp(-dt * 1.9);
      sparkle.vy += 230 * dt;
      sparkle.x += sparkle.vx * dt;
      sparkle.y += sparkle.vy * dt;
    }
    this.sparkles = this.sparkles.filter((sparkle) => sparkle.age < sparkle.duration);
  }

  updateSplits(dt) {
    for (const body of [...this.bodies]) {
      const drags = this.bodyDrags(body);
      const canSplit = body.tier > 0 && this.bodies.length < this.config.maxBodies;
      const active = canSplit && drags.length === 2 && body.actualStretch >= MERGE_RULES.splitStretch;
      const target = active ? 1 : 0;
      const duration = active ? MERGE_RULES.splitHoldDuration : 0.13;
      body.splitProgress += (target - body.splitProgress) * (1 - Math.exp(-dt / duration));
      if (active && body.splitProgress >= 0.72) this.splitBody(body);
    }
  }

  desiredCenter(body) {
    const drags = this.bodyDrags(body);
    if (drags.length !== 1) return { ...body.particles[0] };
    const drag = drags[0];
    return {
      x: drag.targetX + drag.offsetX - (drag.inputOffsetX ?? 0),
      y: drag.targetY + drag.offsetY - (drag.inputOffsetY ?? 0),
    };
  }

  fusionPressure(a, b) {
    const centerA = a.particles[0];
    const centerB = b.particles[0];
    const dx = centerB.x - centerA.x;
    const dy = centerB.y - centerA.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / length;
    const ny = dy / length;
    const naturalReach = Math.max(20, Math.hypot(
      nx * (a.width + b.width) * 0.46,
      ny * (a.height + b.height) * 0.46,
    ));
    const desiredA = this.desiredCenter(a);
    const desiredB = this.desiredCenter(b);
    const desiredDistance = Math.hypot(desiredB.x - desiredA.x, desiredB.y - desiredA.y);
    return clamp((naturalReach - desiredDistance) / (naturalReach * 0.38), 0, 1);
  }

  contactResponse(a, b) {
    if (!this.pairCanFuse(a, b)) return 1;
    const dragsA = this.bodyDrags(a);
    const dragsB = this.bodyDrags(b);
    if (dragsA.length > 1 || dragsB.length > 1 || dragsA.length + dragsB.length === 0) return 1;
    const pressure = this.fusionPressure(a, b);
    if (pressure >= 0.15) return 0.008;
    if (pressure >= 0.03) return 0.18;
    return 1;
  }

  updateFusion(dt) {
    for (const body of this.bodies) {
      body.fusionProgress = 0;
      body.mergeGazeTargetId = null;
    }
    const candidates = [];
    const validKeys = new Set();
    for (let aIndex = 0; aIndex < this.bodies.length; aIndex += 1) {
      const a = this.bodies[aIndex];
      for (let bIndex = aIndex + 1; bIndex < this.bodies.length; bIndex += 1) {
        const b = this.bodies[bIndex];
        if (a.tier !== b.tier) continue;
        const maximumPair = a.tier === PUDDING_TIERS.length - 1;
        if (!maximumPair && a.colorIndex !== b.colorIndex) continue;
        const key = pairKey(a, b);
        validKeys.add(key);
        const state = this.fusionPairs.get(key) ?? { progress: 0, pressure: 0 };
        this.fusionPairs.set(key, state);
        const dragsA = this.bodyDrags(a);
        const dragsB = this.bodyDrags(b);
        const oneGripEachAtMost = dragsA.length <= 1 && dragsB.length <= 1;
        const handActive = dragsA.length + dragsB.length > 0;
        const unlocked = this.time >= a.noMergeUntil && this.time >= b.noMergeUntil;
        const touching = a.contactBodyIds.has(b.id) || b.contactBodyIds.has(a.id)
          || paddedOverlap(a, b, 7);
        const pressure = oneGripEachAtMost && handActive && unlocked && touching
          ? this.fusionPressure(a, b) : 0;
        state.pressure = pressure;
        candidates.push({ a, b, key, state, pressure, active: pressure >= MERGE_RULES.deepPressThreshold });
      }
    }

    for (const [key] of this.fusionPairs) {
      if (!validKeys.has(key)) this.fusionPairs.delete(key);
    }

    candidates.sort((left, right) => (
      right.pressure + right.state.progress * 0.35
      - left.pressure - left.state.progress * 0.35
    ));
    const claimed = new Set();
    const completed = [];
    for (const candidate of candidates) {
      const available = !claimed.has(candidate.a.id) && !claimed.has(candidate.b.id);
      if (available && candidate.active) {
        claimed.add(candidate.a.id);
        claimed.add(candidate.b.id);
        candidate.state.progress = Math.min(
          1,
          candidate.state.progress + dt / MERGE_RULES.holdDuration,
        );
      } else {
        candidate.state.progress = Math.max(
          0,
          candidate.state.progress - dt / MERGE_RULES.releaseRecovery,
        );
      }
      candidate.a.fusionProgress = Math.max(candidate.a.fusionProgress, candidate.state.progress);
      candidate.b.fusionProgress = Math.max(candidate.b.fusionProgress, candidate.state.progress);
      if (candidate.state.progress > 0.04) {
        candidate.a.mergeGazeTargetId = candidate.b.id;
        candidate.b.mergeGazeTargetId = candidate.a.id;
      }
      if (candidate.state.progress >= 1) completed.push(candidate);
    }

    for (const candidate of completed) {
      if (!this.bodies.includes(candidate.a) || !this.bodies.includes(candidate.b)) continue;
      this.fuseBodies(candidate.a, candidate.b);
    }
  }

  cancelBodyDrags(bodies) {
    const bodySet = new Set(bodies);
    const pointerIds = [...this.drags.values()]
      .filter((drag) => bodySet.has(drag.body))
      .map((drag) => drag.pointerId);
    for (const pointerId of pointerIds) this.endDrag(pointerId, { cancel: true, time: this.time });
    return pointerIds;
  }

  removeBodies(bodies) {
    const removedIds = new Set(bodies.map((body) => body.id));
    this.bodies = this.bodies.filter((body) => !removedIds.has(body.id));
    for (const key of [...this.fusionPairs.keys()]) {
      const [aId, bId] = key.split(":").map(Number);
      if (removedIds.has(aId) || removedIds.has(bId)) this.fusionPairs.delete(key);
    }
  }

  fuseBodies(a, b) {
    const releasedPointerIds = this.cancelBodyDrags([a, b]);
    const maximumTier = PUDDING_TIERS.length - 1;
    const centerA = a.particles[0];
    const centerB = b.particles[0];
    const x = (centerA.x + centerB.x) * 0.5;
    const y = (centerA.y + centerB.y) * 0.5;
    const velocityA = bodyVelocity(a);
    const velocityB = bodyVelocity(b);
    const sourceIds = [a.id, b.id];
    this.removeBodies([a, b]);

    if (a.tier === maximumTier) {
      this.createCaramelBurst(x, y, a.id * 131 + b.id * 977);
      this.events.push({
        type: "burst",
        sourceIds,
        colorIndices: [a.colorIndex, b.colorIndex],
        x,
        y,
        releasedPointerIds,
        time: this.time,
      });
      return null;
    }

    const tier = a.tier + 1;
    const merged = this.addPudding({
      tier,
      colorIndex: a.colorIndex,
      x,
      y,
      vx: (velocityA.x + velocityB.x) * 30,
      vy: Math.min(-115, (velocityA.y + velocityB.y) * 24 - 70),
      noMergeUntil: this.time + 0.62,
      mergeBirthAt: this.time,
    });
    if (merged) {
      this.startElasticShape(merged, 0.62);
      this.setExpression(merged, "surprised", 0.38, "sly", 0.48);
    }
    this.events.push({
      type: "merged",
      sourceIds,
      resultId: merged?.id ?? null,
      tier,
      colorIndex: a.colorIndex,
      releasedPointerIds,
      time: this.time,
    });
    return merged;
  }

  splitBody(bodyOrId, options = {}) {
    const body = this.getBody(bodyOrId);
    if (!body || body.tier <= 0 || this.bodies.length >= this.config.maxBodies) {
      if (body && options.force) {
        this.events.push({ type: "split-blocked", bodyId: body.id, reason: body.tier <= 0 ? "smallest" : "limit", time: this.time });
      }
      return null;
    }
    const releasedPointerIds = this.cancelBodyDrags([body]);
    const center = { ...body.particles[0] };
    const sourceId = body.id;
    const sourceTier = body.tier;
    const childTier = sourceTier - 1;
    const childSpec = PUDDING_TIERS[childTier];
    const axis = body.twoGripAxis ?? body.gestureAxes ?? { x: 1, y: 0 };
    const axisLength = Math.max(0.001, Math.hypot(axis.x, axis.y));
    const ux = axis.x / axisLength;
    const uy = axis.y / axisLength;
    const separation = childSpec.width * 0.5;
    const velocity = bodyVelocity(body);
    const colorIndex = body.colorIndex;
    this.removeBodies([body]);
    const children = [-1, 1].map((direction) => this.addPudding({
      tier: childTier,
      colorIndex,
      x: center.x + ux * separation * direction,
      y: center.y + uy * separation * direction,
      vx: velocity.x * 42 + ux * direction * 115,
      vy: velocity.y * 42 + uy * direction * 70 - 36,
      noMergeUntil: this.time + MERGE_RULES.splitMergeLock,
      splitBirthAt: this.time,
    })).filter(Boolean);
    for (const child of children) {
      child.gestureSurprise = 1;
      child.renderGestureSurprise = 1;
      this.setExpression(child, "eek", 0.58, "surprised", 0.24);
      this.startElasticShape(child, -0.24);
    }
    this.events.push({
      type: "split",
      sourceId,
      sourceTier,
      childIds: children.map((child) => child.id),
      childTier,
      colorIndex,
      releasedPointerIds,
      time: this.time,
    });
    return children;
  }

  splitAt(x, y) {
    const body = this.hitTest(x, y);
    return body ? this.splitBody(body, { force: true }) : null;
  }

  createCaramelBurst(x, y, seed) {
    const random = seededRandom(seed);
    const colors = ["#ffe596", "#ffc95f", "#d98737", "#fff8d1"];
    for (let index = 0; index < 28; index += 1) {
      const angle = random() * Math.PI * 2;
      const speed = 78 + random() * 185;
      this.sparkles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 85,
        age: 0,
        duration: 0.58 + random() * 0.5,
        size: 2.2 + random() * 4.2,
        spin: random() * Math.PI,
        twinkleDelay: 0.04 + (index % 5) * 0.035,
        twinkleRate: 13 + random() * 8,
        color: colors[index % colors.length],
      });
    }
  }

  snapshot() {
    const snapshot = super.snapshot();
    snapshot.maxBodies = this.addLimit;
    snapshot.hardBodyLimit = this.config.maxBodies;
    snapshot.sparkles = this.sparkles.map((sparkle) => ({ ...sparkle }));
    snapshot.goal = this.goal ? { ...this.goal } : null;
    snapshot.goalProgress = this.goalProgress;
    snapshot.goalQueue = this.goalQueue.map((goal) => ({ ...goal }));
    snapshot.goalCollections = this.goalCollections.map((collection) => ({
      bodyId: collection.bodyId,
      progress: clamp((this.time - collection.startedAt) / collection.duration, 0, 1),
      comboIndex: collection.comboIndex,
    }));
    snapshot.goalCollection = snapshot.goalCollections[0] ?? null;
    snapshot.combo = {
      count: this.comboCount,
      visible: this.comboCount >= 2 && this.time <= this.comboVisibleUntil,
      chainOpen: this.goalChainOpen,
    };
    snapshot.mode = {
      id: this.mode,
      timeLimit: this.timeLimit,
      timeRemaining: this.timeRemaining,
      ended: this.runEnded,
      delivered: this.deliveredCount,
      highestCombo: this.highestCombo,
    };
    snapshot.fusionPairs = [...this.fusionPairs.entries()]
      .filter(([, state]) => state.progress > 0)
      .map(([key, state]) => ({ key, progress: state.progress, pressure: state.pressure }));
    for (let index = 0; index < snapshot.bodies.length; index += 1) {
      const source = this.bodies[index];
      Object.assign(snapshot.bodies[index], {
        tier: source.tier,
        colorIndex: source.colorIndex,
        fusionProgress: source.fusionProgress,
        splitProgress: source.splitProgress,
        noMergeUntil: source.noMergeUntil,
        renderOrder: source.renderOrder,
      });
    }
    return snapshot;
  }
}

import { SoftBodyWorld, physicsMath, REST_RING } from "./physics.js?v=20261006-smooth7";

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
  minimumHandPress: 6,
  contactCompressionScale: 0.18,
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

function mergeContour(a,b,x,y) {
  const points=[...a.particles.slice(1),...b.particles.slice(1)].map(p=>({x:p.x,y:p.y}))
    .sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=values=>{const hull=[];for(const p of values){while(hull.length>1&&cross(hull.at(-2),hull.at(-1),p)<=0)hull.pop();hull.push(p);}return hull;};
  const hull=[...half(points).slice(0,-1),...half([...points].reverse()).slice(0,-1)];
  return REST_RING.map(rest=>{
    const dx=rest.x*a.width,dy=rest.y*a.height;
    let distance=Infinity;
    for(let i=0;i<hull.length;i++) {
      const p=hull[i],q=hull[(i+1)%hull.length],ex=q.x-p.x,ey=q.y-p.y;
      const denominator=dx*ey-dy*ex;
      if(Math.abs(denominator)<.00001)continue;
      const t=((p.x-x)*ey-(p.y-y)*ex)/denominator;
      const u=((p.x-x)*dy-(p.y-y)*dx)/denominator;
      if(t>=0&&u>=0&&u<=1)distance=Math.min(distance,t);
    }
    return Number.isFinite(distance)?{x:x+dx*distance,y:y+dy*distance}:{x:x+dx,y:y+dy};
  });
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

function randomUnit() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] / 4294967296;
  }
  return Math.random();
}

export class MergePuddingWorld extends SoftBodyWorld {
  constructor(options = {}) {
    const hardMaxBodies = options.maxBodies ?? 16;
    super({ ...options, maxBodies: hardMaxBodies });
    this.addLimit = clamp(options.addLimit ?? Math.min(12, hardMaxBodies), 1, hardMaxBodies);
    this.fusionPairs = new Map();
    this.handContactLoads = new Map();
    this.handContactSamples = new Map();
    this.contactRestOffsets = new Map();
    this.sparkles = [];
    this.nextRenderOrder = 1;
    this.addColorCursor = 0;
    // Determinism is an explicit test option, never a production default.
    this.dropRandomState = options.dropSeed === undefined ? null : options.dropSeed >>> 0;
    this.nextDropColorIndex = this.rollDropColor();
    this.goal = null;
    this.goalQueue = [];
    this.goalVersion = 0;
    this.goalProgress = 0;
    this.goalRandomState = options.goalSeed === undefined ? null : options.goalSeed >>> 0;
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
      creamCompression: 0,
    });
    this.nextRenderOrder += 1;
    this.addColorCursor = (colorIndex + 1) % PUDDING_COLORS.length;
    return body;
  }

  rollDropColor() {
    if (this.dropRandomState === null) return Math.floor(randomUnit() * PUDDING_COLORS.length);
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
    this.handContactLoads?.clear();
    this.handContactSamples?.clear();
    this.contactRestOffsets?.clear();
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
        goalReadyAt: this.time + 1.5,
      });
    }
    this.resetGoalQueue();
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
      if(drag.centerGrip && !physicsMath.pointInPolygon(x,y,body.particles.slice(1))) {
        drag.inputOffsetX=x-center.x;drag.inputOffsetY=y-center.y;
      }
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
            pointerAnchorX: center.x,
            pointerAnchorY: center.y,
          };
        });
    }
    return body;
  }

  hitTest(x,y,excludedBodyIds=null) {
    const bodies=[...this.bodies].sort((a,b)=>(b.renderOrder??b.id)-(a.renderOrder??a.id));
    return bodies.find(body=>!excludedBodyIds?.has(body.id) && (
      physicsMath.pointInPolygon(x,y,body.particles.slice(1))
      || physicsMath.decorationPolygons(body,this.time).some(ring=>physicsMath.pointInPolygon(x,y,ring))))??null;
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

  consistentContactCollision(a,b,collision,verticalBias) {
    if(this.pairCanFuse(a,b))return collision;
    for(const [held,other,sign]of[[a,b,1],[b,a,-1]]) {
      const drags=this.bodyDrags(held);
      if(drags.length!==1)continue;
      const drag=drags[0];
      if(drag.contactGuardStep!==this.stepCount)continue;
      const reference=drag.orderConstraints?.find(c=>c.bodyId===other.id&&c.activeThisStep);
      // The swept hand guard and SAT must share one side of the contact.
      // Otherwise a recently retired SAT normal can push the neighbor the
      // opposite way while the hand guard follows it backwards at every step.
      if(reference && (collision.nx*reference.nx+collision.ny*reference.ny)*sign<-.1) {
        const normal={nx:reference.nx*sign,ny:reference.ny*sign};
        return physicsMath.satCollision(a,b,verticalBias,normal)??collision;
      }
    }
    return collision;
  }

  constrainDragTarget(drag, target, gripOffset, limits) {
    const center = drag.body.particles[0];
    if(drag.motionStep!==this.stepCount) {
      const inputDistance=Math.hypot(drag.targetX-(drag.resolvedRawX??drag.startX),
        drag.targetY-(drag.resolvedRawY??drag.startY));
      drag.motionStep=this.stepCount;drag.resolvedRawX=drag.targetX;drag.resolvedRawY=drag.targetY;
      drag.motionTarget=drag.lastJointTarget??{x:center.x+gripOffset.x,y:center.y+gripOffset.y};
      drag.motionTarget={x:clamp(drag.motionTarget.x,limits.left,limits.right),
        y:clamp(drag.motionTarget.y,limits.top,limits.bottom)};
      const contact=(drag.orderConstraints??[]).some(c=>c.contactSeen)
        || drag.body.floorCompression>.02;
      const budget=inputDistance+(contact?drag.pendingInputReach??0:0);
      drag.circularMotion=contact&&budget+2>drag.body.width*.28;
      drag.motionReach=contact?Math.min(budget+2,drag.body.width*.28):budget+2;
      // Distribute a batched input over physics steps without accumulating
      // pressure behind a blocked reference. Unused input budget expires as
      // it is offered to the solver, even if contacts prevent movement.
      drag.pendingInputReach=contact?Math.max(0,budget-drag.motionReach+2):0;
    }
    const range={left:Math.max(limits.left,drag.motionTarget.x-drag.motionReach),
      right:Math.min(limits.right,drag.motionTarget.x+drag.motionReach),
      top:Math.max(limits.top,drag.motionTarget.y-drag.motionReach),
      bottom:Math.min(limits.bottom,drag.motionTarget.y+drag.motionReach)};
    // Bounds take precedence after a resize or a strongly changed floor pose.
    if(range.left>range.right){range.left=limits.left;range.right=limits.right;}
    if(range.top>range.bottom){range.top=limits.top;range.bottom=limits.bottom;}
    const anchor = { x: clamp(center.x + gripOffset.x, range.left, range.right),
      y: clamp(center.y + gripOffset.y, range.top, range.bottom) };
    if(drag.circularMotion) {
      const dx=anchor.x-drag.motionTarget.x,dy=anchor.y-drag.motionTarget.y,length=Math.hypot(dx,dy);
      if(length>drag.motionReach){anchor.x=drag.motionTarget.x+dx*drag.motionReach/length;
        anchor.y=drag.motionTarget.y+dy*drag.motionReach/length;}
    }
    const desired = { x: target.x - gripOffset.x, y: target.y - gripOffset.y };
    const reachable={x:clamp(target.x,range.left,range.right),
      y:clamp(target.y,range.top,range.bottom)};
    if(drag.circularMotion) {
      const x=reachable.x-drag.motionTarget.x,y=reachable.y-drag.motionTarget.y,length=Math.hypot(x,y);
      if(length>drag.motionReach){reachable.x=drag.motionTarget.x+x*drag.motionReach/length;
        reachable.y=drag.motionTarget.y+y*drag.motionReach/length;}
    }
    const dx = reachable.x-gripOffset.x-center.x, dy = reachable.y-gripOffset.y-center.y;
    const planes = [
      { nx: 1, ny: 0, limit: range.right }, { nx: -1, ny: 0, limit: -range.left },
      { nx: 0, ny: 1, limit: range.bottom }, { nx: 0, ny: -1, limit: -range.top },
    ];
    // Broad phase and swept checks run once, on one geometry snapshot. The old
    // per-iteration half-plane sweep could re-anchor twelve times in a step.
    const at = fraction => ({ particles: drag.body.particles.map(p =>
      ({ x: p.x + dx * fraction, y: p.y + dy * fraction })) });
    const prepare = drag.contactGuardStep !== this.stepCount;
    drag.contactGuardStep = this.stepCount;
    let hasContact=drag.body.floorCompression>.02,hasFusionContact=false;
    for (const constraint of drag.orderConstraints ?? []) {
      const other = this.getBody(constraint.bodyId);
      if (!other) continue;
      const oc = other.particles[0];
      if (prepare) {
        const t = clamp(((oc.x-center.x)*dx+(oc.y-center.y)*dy)
          / Math.max(.001,dx*dx+dy*dy),0,1);
        const blocked = physicsMath.satCollision(at(1),other,1,null,2)
          || (t > .001 && physicsMath.satCollision(at(t),other,1,null,2));
        if (!blocked) {
          // Update from the actual mass, never the far-ahead pointer. Contact
          // normals remain fixed through this step's position iterations.
          const nx=oc.x-center.x, ny=oc.y-center.y, length=Math.max(.001,Math.hypot(nx,ny));
          constraint.nx=nx/length; constraint.ny=ny/length;
          constraint.pointerAnchorX=center.x; constraint.pointerAnchorY=center.y;
          constraint.contactSeen=false;
          constraint.activeThisStep=false;
          drag.collisionAnchorX=center.x; drag.collisionAnchorY=center.y;
          continue;
        }
        const wasActive=constraint.activeThisStep;
        constraint.contactSeen=true;
        constraint.activeThisStep=true;
        const support=(body,nx,ny)=>Math.max(...body.particles.slice(1).map(p=>
          (p.x-body.particles[0].x)*nx+(p.y-body.particles[0].y)*ny));
        const supportGap=.5*(support(drag.body,constraint.nx,constraint.ny)
          +support(other,-constraint.nx,-constraint.ny));
        constraint.supportGap=wasActive?constraint.supportGap+(supportGap-constraint.supportGap)*.15:supportGap;
      }
      if(!constraint.activeThisStep)continue;
      const key=pairKey(drag.body,other);
      const compatible=this.pairCanFuse(drag.body,other);
      hasContact=true;hasFusionContact ||=compatible;
      const scale=compatible?Math.min(drag.body.fusionPose?.normalScale??1,other.fusionPose?.normalScale??1):1;
      const minimumGap=compatible?.435*scale*(
        Math.abs(constraint.nx)*(drag.body.width+other.width)
        +Math.abs(constraint.ny)*(drag.body.height+other.height)):constraint.supportGap;
      const separation=(oc.x-desired.x)*constraint.nx+(oc.y-desired.y)*constraint.ny;
      const correction=minimumGap-separation;
      const travel=(drag.targetX-drag.startX)*constraint.nx+(drag.targetY-drag.startY)*constraint.ny;
      if(travel>MERGE_RULES.minimumHandPress && correction>MERGE_RULES.minimumHandPress) {
        const sign=drag.body.id<other.id?1:-1;
        const previous=this.handContactLoads.get(key);
        if(!previous||previous.load<correction)
          this.handContactLoads.set(key,{nx:constraint.nx*sign,ny:constraint.ny*sign,load:correction});
      }
      // A crowded floor can make nominal center gaps mutually impossible.
      // Preserve the existing separation in that case, allowing SAT to push
      // the other mass softly instead of sending this grip below the floor.
      const existing=(oc.x-anchor.x+gripOffset.x)*constraint.nx
        +(oc.y-anchor.y+gripOffset.y)*constraint.ny;
      const nominalGap=travel>MERGE_RULES.minimumHandPress?minimumGap:Math.min(minimumGap,existing);
      // A compressed neighbor may spread or settle while the hand is off the
      // floor too. Do not move the hand backwards just to restore its nominal
      // support radius. SAT preserves positive order and resolves the actual
      // soft contact; intentional fusion keeps its original pressure gap.
      const orderGap=.18*(Math.abs(constraint.nx)*(drag.body.width+other.width)
        +Math.abs(constraint.ny)*(drag.body.height+other.height));
      const referenceSeparation=(oc.x-drag.motionTarget.x+gripOffset.x)*constraint.nx
        +(oc.y-drag.motionTarget.y+gripOffset.y)*constraint.ny;
      const gap=compatible?nominalGap:Math.max(orderGap,
        Math.min(nominalGap,existing,referenceSeparation));
      planes.push({nx:constraint.nx,ny:constraint.ny,
        limit:oc.x*constraint.nx+oc.y*constraint.ny-gap
          +gripOffset.x*constraint.nx+gripOffset.y*constraint.ny,
        relaxedLimit:oc.x*constraint.nx+oc.y*constraint.ny-Math.min(gap,existing)
          +gripOffset.x*constraint.nx+gripOffset.y*constraint.ny});
    }
    // Closest point in the joint convex feasible region: order-independent,
    // bounded, and anchored by a known feasible point in compressed stacks.
    const radius=drag.motionReach,origin=drag.motionTarget;
    // Pressure still uses the raw goal above. The positional projection uses
    // this step's reachable goal: a far-ahead finger must not buy a few pixels
    // of horizontal travel by pulling the hand far along a slanted contact.
    const aim=reachable;
    const inMotionRange=p=>!drag.circularMotion
      ||(p.x-origin.x)**2+(p.y-origin.y)**2<=radius*radius+1e-6;
    const feasible=p=>inMotionRange(p)&&planes.every(h=>p.x*h.nx+p.y*h.ny<=h.limit+1e-6);
    const finish=p=>{
      if(drag.resolvedMotionStep!==this.stepCount) {
        const previous=drag.lastJointTarget??p;
        drag.resolvedMoveX=p.x-previous.x;drag.resolvedMoveY=p.y-previous.y;
        drag.resolvedMotionStep=this.stepCount;
      }
      drag.lastJointTarget={...p};
      // A material hand anchor is fixed during the position solve. Fusion
      // alone needs the updated opposing mass to remain pressure-driven.
      drag.freezeResolvedTarget=hasContact&&!hasFusionContact;
      return p;
    };
    let best=null, distance=Infinity;
    const consider=p=>{if(!feasible(p))return;const d=(p.x-aim.x)**2+(p.y-aim.y)**2;
      if(d<distance){best=p;distance=d;}};
    for(let pass=0;pass<2;pass++) {
      consider(aim); consider(anchor);
      if(drag.circularMotion) {
        const dx=aim.x-origin.x,dy=aim.y-origin.y,length=Math.hypot(dx,dy);
        if(length>radius)consider({x:origin.x+dx*radius/length,y:origin.y+dy*radius/length});
      }
      if(distance<1e-12)return finish(best);
      for(let i=0;i<planes.length;i++) {
        const a=planes[i], amount=aim.x*a.nx+aim.y*a.ny-a.limit;
        consider({x:aim.x-a.nx*amount,y:aim.y-a.ny*amount});
        if(drag.circularMotion) {
          const signed=origin.x*a.nx+origin.y*a.ny-a.limit;
          if(Math.abs(signed)<=radius) {
            const span=Math.sqrt(Math.max(0,radius*radius-signed*signed));
            const x=origin.x-a.nx*signed,y=origin.y-a.ny*signed;
            consider({x:x-a.ny*span,y:y+a.nx*span});
            consider({x:x+a.ny*span,y:y-a.nx*span});
          }
        }
        for(let j=0;j<i;j++) {
          const b=planes[j], det=a.nx*b.ny-a.ny*b.nx;
          if(Math.abs(det)<1e-8)continue;
          consider({x:(a.limit*b.ny-a.ny*b.limit)/det,y:(a.nx*b.limit-a.limit*b.nx)/det});
        }
      }
      if(best)return finish(best);
      for(const plane of planes)plane.limit=plane.relaxedLimit??plane.limit;
    }
    return finish(anchor);
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
    this.handContactLoads.clear();
    this.handContactSamples.clear();
    this.contactRestOffsets.clear();
    super.step(dt);
    const elapsed = this.time - before;
    if (elapsed <= 0) return;
    this.solveDecorationContacts(elapsed);
    const stepEvents = this.events.slice(eventStart);
    this.updateSparkles(elapsed);
    this.updateIdleLife(elapsed, stepEvents);
    this.updateSplits(elapsed);
    this.updateFusion(elapsed);
    this.updateGoalSystem();
    this.advanceModeClock(elapsed);
  }

  solveDecorationContacts(dt) {
    const bounds=new Map(this.bodies.map(body=>[body,physicsMath.bodyAabb(body)]));
    for (const owner of this.bodies) {
      if (!owner.tier) continue;
      let compression=0;
      const caps=physicsMath.decorationPolygons(owner,this.time).map(ring=>{
        const body=physicsMath.polygonBody(ring);return {body,bounds:physicsMath.bodyAabb(body)};
      });
      for (const other of this.bodies) {
        if(other===owner || owner.fusionProgress>.02 || other.fusionProgress>.02) continue;
        let contact=null;
        for(const cap of caps) {
          const box=bounds.get(other),cb=cap.bounds;
          if(box.maxX<cb.minX||box.minX>cb.maxX||box.maxY<cb.minY||box.minY>cb.maxY)continue;
          const hit=physicsMath.satCollision(cap.body,other);
          if(hit && (!contact||hit.overlap>contact.overlap)) contact=hit;
        }
        if(!contact) continue;
        compression=Math.max(compression,clamp(contact.overlap/(owner.height*.11),0,.72));
        if(other.dragPointer!==null) continue;
        const amount=Math.min(contact.overlap,5)*.4;
        for(const p of other.particles) {
          const vx=p.x-p.px,vy=p.y-p.py,normal=vx*contact.nx+vy*contact.ny;
          const kept=Math.min(0,normal)*.78;
          p.x+=contact.nx*amount;p.y+=contact.ny*amount;
          p.px=p.x-vx+contact.nx*kept;p.py=p.y-vy+contact.ny*kept;
        }
        this.solveBounds(other,dt);
        if(contact.ny<-.5) {other.isSupported=true;other.supportBodyId=owner.id;other.airborneSteps=0;other.isScared=false;}
      }
      owner.creamCompression+=(compression-owner.creamCompression)*(1-Math.exp(-dt/.065));
    }
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
    if (this.goalRandomState === null) return randomUnit();
    this.goalRandomState = (Math.imul(this.goalRandomState, 1664525) + 1013904223) >>> 0;
    return this.goalRandomState / 4294967296;
  }

  goalMatches(body, goal = this.goal) {
    return Boolean(goal) && body.colorIndex === goal.colorIndex && body.tier === goal.tier;
  }

  makeGoal() {
    const choice = Math.floor(this.nextGoalRandom() * PUDDING_COLORS.length * PUDDING_TIERS.length);
    const candidate = this.goalScript.length > 0 ? this.goalScript.shift()
      : { colorIndex: choice % PUDDING_COLORS.length, tier: Math.floor(choice / PUDDING_COLORS.length) };
    const normalized = {
      colorIndex: clamp(Math.round(candidate.colorIndex ?? 0), 0, PUDDING_COLORS.length - 1),
      tier: clamp(Math.round(candidate.tier ?? 0), 0, PUDDING_TIERS.length - 1),
    };
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
      this.goalQueue.push(this.makeGoal());
    }
    return this.syncCurrentGoal(options);
  }

  setGoal(goal, options = {}) {
    return this.setGoalQueue([goal], options);
  }

  resetGoalQueue() {
    this.goalQueue = [];
    while (this.goalQueue.length < 3) {
      this.goalQueue.push(this.makeGoal());
    }
    return this.syncCurrentGoal({ immediate: false });
  }

  advanceGoalQueue() {
    this.goalQueue.shift();
    this.goalQueue.push(this.makeGoal());
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

  materialContactOffsets(body) {
    if(this.contactRestOffsets.has(body.id))return this.contactRestOffsets.get(body.id);
    const pose=body.fusionPose;
    const offsets=this.posedOffsets(body,pose?.axes);
    if(pose)for(const offset of offsets) {
      const normal=offset.x*pose.nx+offset.y*pose.ny;
      const tx=offset.x-pose.nx*normal,ty=offset.y-pose.ny*normal;
      offset.x=pose.nx*normal*pose.normalScale+tx*pose.transverseScale;
      offset.y=pose.ny*normal*pose.normalScale+ty*pose.transverseScale;
    }
    this.contactRestOffsets.set(body.id,offsets);
    return offsets;
  }

  contactCompression(body,nx,ny,contacts) {
    const rest=this.materialContactOffsets(body),center=body.particles[0];
    const reach=Math.max(10,...rest.map(p=>p.x*nx+p.y*ny));
    let compression=0,count=0;
    for(const point of contacts) {
      const index=body.particles.indexOf(point);
      if(index<1)continue;
      const expected=rest[index].x*nx+rest[index].y*ny;
      if(expected<reach*.35)continue;
      const actual=(point.x-center.x)*nx+(point.y-center.y)*ny;
      compression+=Math.max(0,expected-actual)/reach;count++;
    }
    return count?compression/count:0;
  }

  recordBodyContact(a,b,collision,contactsA,contactsB) {
    if(!this.handContactLoads.has(pairKey(a,b)) || !this.pairCanFuse(a,b))return;
    // Sample actual contact-patch deformation. The nominal material pose
    // includes the fusion animation, so that animation cannot feed itself.
    this.materialContactOffsets(a);this.materialContactOffsets(b);
    this.handContactSamples.set(pairKey(a,b),{
      nx:collision.nx,ny:collision.ny,contactsA,contactsB,aId:a.id,
    });
  }

  contactBulkDepth(a,b,collision,depth) {
    if(!this.handContactLoads.has(pairKey(a,b)) || a.fusionProgress>.04 || b.fusionProgress>.04)return depth;
    const reach=Math.max(30,Math.min(
      Math.hypot(collision.nx*a.width,collision.ny*a.height),
      Math.hypot(collision.nx*b.width,collision.ny*b.height)));
    const yieldAmount=clamp((collision.overlap/reach-.08)/.18,0,1);
    // Yield smoothly: first a soft dent, then more whole-mass displacement.
    return depth+collision.overlap*(.10+.30*yieldAmount);
  }

  areaConstraintStrength(body) {
    return this.bodyDrags(body).length===1 && body.contactBodyIds.size>0
      && !body.fusionPose && body.floorCompression<.2 ? .23:.085;
  }

  fusionPressure(a, b) {
    const key=pairKey(a,b),sample=this.handContactSamples.get(key),load=this.handContactLoads.get(key);
    if(!sample || !load)return 0;
    const sign=sample.aId===a.id?1:-1,nx=sample.nx*sign,ny=sample.ny*sign;
    const loadSign=a.id<b.id?1:-1;
    if((load.nx*nx+load.ny*ny)*loadSign<.5)return 0;
    const contactsA=sign===1?sample.contactsA:sample.contactsB;
    const contactsB=sign===1?sample.contactsB:sample.contactsA;
    const compression=Math.max(this.contactCompression(a,nx,ny,contactsA),
      this.contactCompression(b,-nx,-ny,contactsB));
    return clamp(compression/MERGE_RULES.contactCompressionScale,0,1);
  }

  contactResponse(a, b) {
    // Intention changes the material rest shape, never its opacity or solidity.
    return 1;
  }

  contactBulkMobility(body,other,mobility) {
    // A hand resists whole-mass pushback; the contact patch stays soft.
    // Intentional fusion keeps its original mass response.
    return this.bodyDrags(body).length===1
      && !this.pairCanFuse(body,other)?Math.min(mobility,.02):mobility;
  }



  solveAdditionalShape(body) {
    const pose=body.fusionPose;
    if(!pose)return;
    const center=body.particles[0];
    const correctionX=(pose.centerX-center.x)*.3,correctionY=(pose.centerY-center.y)*.3;
    for(const point of body.particles) {
      point.x+=correctionX;point.y+=correctionY;
      point.px+=correctionX;point.py+=correctionY;
    }
    for(let i=0;i<REST_RING.length;i++) {
      const rest=REST_RING[i],rx=rest.x*body.width,ry=rest.y*body.height;
      const wx=pose.axes.ux*rx+pose.axes.vx*ry,wy=pose.axes.uy*rx+pose.axes.vy*ry;
      const normal=wx*pose.nx+wy*pose.ny;
      const x=pose.nx*normal*pose.normalScale+(wx-pose.nx*normal)*pose.transverseScale;
      const y=pose.ny*normal*pose.normalScale+(wy-pose.ny*normal)*pose.transverseScale;
      const point=body.particles[i+1];
      point.x+=(center.x+x-point.x)*.24;point.y+=(center.y+y-point.y)*.24;
    }
  }

  updateFusion(dt) {
    for (const body of this.bodies) {
      body.fusionProgress = 0;
      body.mergeGazeTargetId = null;
      body.fusionPose = null;
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
        const state = this.fusionPairs.get(key) ?? { progress: 0, pressure: 0,
          axesA:physicsMath.normalizedBodyAxes(a),axesB:physicsMath.normalizedBodyAxes(b),
          centerA:{x:a.particles[0].x,y:a.particles[0].y},centerB:{x:b.particles[0].x,y:b.particles[0].y},
          nx:(b.particles[0].x-a.particles[0].x)/Math.max(.001,Math.hypot(b.particles[0].x-a.particles[0].x,b.particles[0].y-a.particles[0].y)),
          ny:(b.particles[0].y-a.particles[0].y)/Math.max(.001,Math.hypot(b.particles[0].x-a.particles[0].x,b.particles[0].y-a.particles[0].y)) };
        this.fusionPairs.set(key, state);
        const dragsA = this.bodyDrags(a);
        const dragsB = this.bodyDrags(b);
        const oneGripEachAtMost = dragsA.length <= 1 && dragsB.length <= 1;
        const handActive = dragsA.length + dragsB.length > 0;
        const unlocked = this.time >= a.noMergeUntil && this.time >= b.noMergeUntil;
        const sample=this.handContactSamples.get(key);
        const preferred=sample?{nx:sample.nx*(sample.aId===a.id?1:-1),ny:sample.ny*(sample.aId===a.id?1:-1)}:null;
        const touching = Boolean(sample && physicsMath.satCollision(a,b,1,preferred,1.5));
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
        if(candidate.state.progress===0) {
          const {a,b,state}=candidate,dx=b.particles[0].x-a.particles[0].x,dy=b.particles[0].y-a.particles[0].y;
          const length=Math.max(.001,Math.hypot(dx,dy));state.nx=dx/length;state.ny=dy/length;
          state.axesA=physicsMath.normalizedBodyAxes(a);state.axesB=physicsMath.normalizedBodyAxes(b);
          state.centerA={x:a.particles[0].x,y:a.particles[0].y};state.centerB={x:b.particles[0].x,y:b.particles[0].y};
        }
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
      if(candidate.state.progress>0 && available) {
        const {a,b,state}=candidate,p=state.progress*state.progress*(3-2*state.progress);
        const next=PUDDING_TIERS[Math.min(a.tier+1,PUDDING_TIERS.length-1)];
        const sourceReach=Math.hypot(state.nx*a.width,state.ny*a.height);
        const nextReach=Math.hypot(state.nx*next.width,state.ny*next.height);
        const sourceAcross=Math.hypot(state.ny*a.width,state.nx*a.height);
        const nextAcross=Math.hypot(state.ny*next.width,state.nx*next.height);
        const normalScale=1+(nextReach/(2*sourceReach)-1)*p;
        const transverseScale=1+(nextAcross/sourceAcross-1)*p;
        const midX=(state.centerA.x+state.centerB.x)*.5,midY=(state.centerA.y+state.centerB.y)*.5;
        const pose={nx:state.nx,ny:state.ny,normalScale,transverseScale};
        a.fusionPose={...pose,axes:state.axesA,centerX:midX+(state.centerA.x-midX)*normalScale,
          centerY:midY+(state.centerA.y-midY)*normalScale};
        b.fusionPose={...pose,axes:state.axesB,centerX:midX+(state.centerB.x-midX)*normalScale,
          centerY:midY+(state.centerB.y-midY)*normalScale};
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
    for (const map of [this.fusionPairs,this.handContactLoads,this.handContactSamples]) {
      for (const key of [...map.keys()]) {
        const [aId, bId] = key.split(":").map(Number);
        if (removedIds.has(aId) || removedIds.has(bId))map.delete(key);
      }
    }
    for(const id of removedIds)this.contactRestOffsets.delete(id);
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
    const contour=mergeContour(a,b,x,y);
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
      contour.forEach((position,index)=>{
        const point=merged.particles[index+1],vx=point.x-point.px,vy=point.y-point.py;
        point.x=position.x;point.y=position.y;point.px=point.x-vx;point.py=point.y-vy;
        point.renderX=point.x;point.renderY=point.y;
      });
      this.startElasticShape(merged, 0.14);
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

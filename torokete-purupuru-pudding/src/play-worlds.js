import { MergePuddingWorld, PUDDING_TIERS } from './merge-world.js';
import { REST_RING, physicsMath } from './physics.js';

// Free play uses the released material unchanged; goals never claim a creation.
export class FreePuddingWorld extends MergePuddingWorld {
  constructor(options = {}) { super(options); this.mode = 'free'; this.nextDropColorIndex = 0; }
  rollDropColor() { return 0; }
  addPudding(options = {}) { return super.addPudding({ ...options, colorIndex: 0 }); }
  resetGoalQueue() { this.goal = null; this.goalQueue = []; this.goalCollections = []; }
  updateGoalSystem() {}
  get capacityCount() { return this.bodies.length; }
}

const mochiClamp = physicsMath.clamp;
const mochiRing = body => body.particles.slice(1);
const mochiCenter = body => {
  const ring = mochiRing(body), center = body.particles[0];
  center.x = ring.reduce((sum,p)=>sum+p.x,0)/ring.length;
  center.y = ring.reduce((sum,p)=>sum+p.y,0)/ring.length;
};
const mochiPoint = drag => drag.body.particles[drag.grip[0].index];
function mochiHull(points) {
  const sorted = points.map(p=>({x:p.x,y:p.y})).sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=values=>{const hull=[];for(const p of values){while(hull.length>1&&cross(hull.at(-2),hull.at(-1),p)<=0)hull.pop();hull.push(p);}return hull;};
  return [...half(sorted).slice(0,-1),...half([...sorted].reverse()).slice(0,-1)];
}
function mochiContour(points,x,y,width,height) {
  const hull=mochiHull(points);
  return REST_RING.map(rest=>{
    const dx=rest.x*width,dy=rest.y*height;let distance=Infinity;
    for(let i=0;i<hull.length;i++){
      const p=hull[i],q=hull[(i+1)%hull.length],ex=q.x-p.x,ey=q.y-p.y,den=dx*ey-dy*ex;
      if(Math.abs(den)<1e-6)continue;
      const t=((p.x-x)*ey-(p.y-y)*ex)/den,u=((p.x-x)*dy-(p.y-y)*dx)/den;
      if(t>=0&&u>=0&&u<=1)distance=Math.min(distance,t);
    }
    return {x:x+dx*(Number.isFinite(distance)?distance:1),y:y+dy*(Number.isFinite(distance)?distance:1)};
  });
}

// A separate material solver protects smooth7's tier/goal physics. The same
// twelve boundary vertices, artwork, face rig and DOM input API are retained.
// Local grips and a remote sticky foot let one end lift without dragging the
// whole mass off the floor. Rest lengths relax only after the hand lets go.
export class MochiPuddingWorld extends FreePuddingWorld {
  constructor(options = {}) { super(options); this.mode = 'mochi'; }
  get capacityCount() { return this.bodies.reduce((sum,b)=>sum+b.units,0); }
  addNextDrop(options = {}) {
    if(this.capacityCount>=this.addLimit)return null;
    return this.addPudding({...options,units:1});
  }
  addPudding(options = {}) {
    const units=mochiClamp(Math.round(options.units??1),1,this.addLimit);
    const spec=PUDDING_TIERS[0],scale=Math.sqrt(units);
    const fit=Math.min(1,this.width*.72/(spec.width*scale),this.floorY*.7/(spec.height*scale));
    const body=super.addPudding({...options,tier:0,width:spec.width*scale*fit,height:spec.height*scale*fit});
    if(!body)return null;
    body.units=units;body.isMochi=true;body.mochiFoot=null;body.mochiMergedAt=-Infinity;
    body.mochiLinks=[];
    for(let i=0;i<12;i++)for(const stride of [1,2]){
      const a=i+1,b=(i+stride)%12+1,ra=REST_RING[a-1],rb=REST_RING[b-1];
      const rest=Math.hypot((ra.x-rb.x)*body.width,(ra.y-rb.y)*body.height);
      body.mochiLinks.push({a,b,rest,roundRest:rest,edge:stride===1});
    }
    for(let i=0;i<6;i++){
      const a=i+1,b=i+7,ra=REST_RING[a-1],rb=REST_RING[b-1];
      const rest=Math.hypot((ra.x-rb.x)*body.width,(ra.y-rb.y)*body.height);
      body.mochiLinks.push({a,b,rest,roundRest:rest,edge:false,diameter:true});
    }
    return body;
  }
  beginDrag(pointerId,x,y,options={}) {
    if(this.paused||this.stopped||this.drags.has(pointerId)||!Number.isFinite(x+y))return null;
    const body=options.body??this.hitTest(x,y);
    if(!body||this.bodyDrags(body).length>=2)return null;
    let index=1,best=Infinity;
    body.particles.slice(1).forEach((p,i)=>{const d=Math.hypot(p.x-x,p.y-y);if(d<best){best=d;index=i+1;}});
    const p=body.particles[index];
    this.drags.set(pointerId,{pointerId,body,targetX:x,targetY:y,startX:x,startY:y,
      grip:[{index,weight:1}],inputOffsetX:p.x-x,inputOffsetY:p.y-y,
      resolvedX:p.x,resolvedY:p.y,inputTime:options.time??this.time,
      velocityX:0,velocityY:0,lastMoveX:0,lastMoveY:0,maximumDistance:0});
    body.dragPointer=pointerId;body.renderOrder=this.nextRenderOrder++;
    body.mochiFoot=null;
    if(body.units>1&&this.bodyDrags(body).length===1){
      const foot=body.particles.slice(1).map((q,i)=>({q,index:i+1}))
        .filter(({q})=>this.floorY-q.y<7&&Math.abs(q.x-p.x)>body.width*.38)
        .sort((a,b)=>Math.abs(b.q.x-p.x)-Math.abs(a.q.x-p.x))[0];
      if(foot){
        body.mochiFoot={index:foot.index,x:foot.q.x,y:this.floorY,patch:[]};
        for(const index of [(foot.index+10)%12+1,foot.index,foot.index%12+1]){
          const q=body.particles[index];
          if(this.floorY-q.y<9)body.mochiFoot.patch.push({index,x:q.x,y:this.floorY});
        }
      }
    }
    this.wakeBody(body);body.isScared=false;return body;
  }
  endDrag(pointerId,options={}) {
    const drag=this.drags.get(pointerId);if(!drag)return null;
    this.drags.delete(pointerId);const body=drag.body,kept=this.bodyDrags(body);
    body.dragPointer=kept[0]?.pointerId??null;body.mochiFoot=null;
    if(!kept.length){
      for(const link of body.mochiLinks){const a=body.particles[link.a],b=body.particles[link.b];link.rest=Math.hypot(b.x-a.x,b.y-a.y);}
      for(const p of mochiRing(body)){p.px=p.x-(p.x-p.px)*.18;p.py=p.y-(p.y-p.py)*.18;}
      if(!options.cancel)this.setExpression(body,'hmph',.22,'sly',.65);
      body.stretchCryUntil=this.time+.13;
    }
    return body;
  }
  splitBody() { return null; }
  splitAt() { return null; }
  poke(bodyOrId,x,y,strength=1) {
    const body=this.getBody(bodyOrId)??this.hitTest(x,y);if(!body)return false;
    const center=body.particles[0];
    for(const p of mochiRing(body)){
      const d=Math.hypot(p.x-x,p.y-y),amount=Math.exp(-d*d/(body.width*body.width*.12))*3*strength;
      p.x+=(center.x-p.x)/body.width*amount;p.y+=(center.y-p.y)/body.height*amount;
    }
    this.wakeBody(body);this.setExpression(body,'hmph',.35,'sly',.7);
    this.events.push({type:'poke',bodyId:body.id,x,y,time:this.time});return true;
  }
  pinGrips(body) {
    for(const drag of this.bodyDrags(body)){
      const p=mochiPoint(drag),targetX=mochiClamp(drag.targetX+drag.inputOffsetX,5,this.width-5);
      const targetY=mochiClamp(drag.targetY+drag.inputOffsetY,5,this.floorY);
      p.x+=(drag.resolvedX-p.x)*.72;p.y+=(drag.resolvedY-p.y)*.72;
      // Raw target remains available for squeeze pressure, while this step's
      // reachable grip cannot teleport across a dropped display frame.
      drag.rawMaterialX=targetX;drag.rawMaterialY=targetY;
    }
    if(body.mochiFoot&&this.bodyDrags(body).length===1){
      for(const anchor of body.mochiFoot.patch){
        const p=body.particles[anchor.index];
        p.x+=(anchor.x-p.x)*.88;p.y+=(anchor.y-p.y)*.94;
      }
    }
  }
  solveMaterial(body,held) {
    for(const link of body.mochiLinks){
      const a=body.particles[link.a],b=body.particles[link.b],dx=b.x-a.x,dy=b.y-a.y,len=Math.max(.001,Math.hypot(dx,dy));
      const stiffness=held?(link.edge?.13:link.diameter?.014:.045):(link.edge?.23:link.diameter?.035:.065);
      const stretchGuard=Math.max(0,len-link.rest*3.5)*.35;
      const amount=((len-link.rest)*stiffness+stretchGuard)/len*.5;
      a.x+=dx*amount;a.y+=dy*amount;b.x-=dx*amount;b.y-=dy*amount;
    }
    const ring=mochiRing(body),area=physicsMath.polygonArea(ring),gradients=ring.map((p,i)=>{
      const prev=ring[(i+11)%12],next=ring[(i+1)%12];return{x:(next.y-prev.y)*.5,y:(prev.x-next.x)*.5};
    });
    const denominator=gradients.reduce((sum,g)=>sum+g.x*g.x+g.y*g.y,0);
    const lambda=mochiClamp((area-body.restArea)/Math.max(1,denominator)*.16,-.08,.08);
    ring.forEach((p,i)=>{p.x-=gradients[i].x*lambda;p.y-=gradients[i].y*lambda;});
  }
  contain(body) {
    let grounded=false;
    for(const p of mochiRing(body)){
      p.x=mochiClamp(p.x,5,this.width-5);p.y=Math.max(5,p.y);
      if(p.y>=this.floorY){const vx=p.x-p.px;p.y=this.floorY;p.py=p.y;p.px=p.x-vx*.55;grounded=true;}
    }
    body.isGrounded=grounded;body.isSupported=grounded;mochiCenter(body);
  }
  solveMochiContacts() {
    const contacts=[];
    for(let i=0;i<this.bodies.length;i++)for(let j=i+1;j<this.bodies.length;j++){
      const a=this.bodies[i],b=this.bodies[j],key=`${Math.min(a.id,b.id)}:${Math.max(a.id,b.id)}`;
      const prior=this.fusionPairs.get(key),preferred=prior?{nx:prior.nx,ny:prior.ny}:null;
      const hit=physicsMath.satCollision(a,b,1,preferred,.6);if(!hit)continue;
      a.contactBodyIds.add(b.id);b.contactBodyIds.add(a.id);contacts.push({a,b,key,hit});
      const amount=Math.min(8,hit.overlap)*.2;
      for(const [body,sign]of [[a,-1],[b,1]]){
        const held=this.bodyDrags(body).length>0,mobility=held?.14:.8;
        for(const p of mochiRing(body)){const dx=hit.nx*amount*sign*mobility,dy=hit.ny*amount*sign*mobility;p.x+=dx;p.y+=dy;p.px+=dx;p.py+=dy;}
      }
    }
    return contacts;
  }
  updateMochiFusion(contacts,dt) {
    const seen=new Set(),claimed=new Set(),completed=[];
    for(const body of this.bodies){body.fusionProgress=0;body.mergeGazeTargetId=null;}
    const candidates=contacts.map(({a,b,key,hit})=>{
      seen.add(key);const state=this.fusionPairs.get(key)??{progress:0,nx:hit.nx,ny:hit.ny,pressure:0};
      this.fusionPairs.set(key,state);let load=0,travel=0;
      for(const [body,sign]of [[a,1],[b,-1]])for(const d of this.bodyDrags(body)){
        const p=mochiPoint(d);load+=Math.max(0,((d.rawMaterialX??p.x)-p.x)*state.nx*sign+((d.rawMaterialY??p.y)-p.y)*state.ny*sign);
        travel+=Math.max(0,(d.targetX-d.startX)*state.nx*sign+(d.targetY-d.startY)*state.ny*sign);
      }
      const deep=hit.overlap>Math.min(a.width,b.width)*.14&&travel>14;
      state.pressure=mochiClamp(Math.max((load-6)/14,deep?hit.overlap/Math.min(a.width,b.width):0),0,1);
      return{a,b,key,state,active:(load>10||deep)&&this.time>=a.noMergeUntil&&this.time>=b.noMergeUntil};
    }).sort((a,b)=>b.state.progress+b.state.pressure-a.state.progress-a.state.pressure);
    for(const c of candidates){
      const available=!claimed.has(c.a.id)&&!claimed.has(c.b.id);
      if(available&&c.active){claimed.add(c.a.id);claimed.add(c.b.id);c.state.progress=Math.min(1,c.state.progress+dt/.48);}
      else c.state.progress=Math.max(0,c.state.progress-dt/.18);
      c.a.fusionProgress=Math.max(c.a.fusionProgress,c.state.progress);c.b.fusionProgress=Math.max(c.b.fusionProgress,c.state.progress);
      if(c.state.progress>0){c.a.mergeGazeTargetId=c.b.id;c.b.mergeGazeTargetId=c.a.id;}
      if(c.state.progress>=1)completed.push(c);
    }
    for(const [key,state]of this.fusionPairs)if(!seen.has(key)){state.progress=Math.max(0,state.progress-dt/.18);if(!state.progress)this.fusionPairs.delete(key);}
    for(const c of completed)if(this.bodies.includes(c.a)&&this.bodies.includes(c.b))this.fuseBodies(c.a,c.b);
  }
  fuseBodies(a,b) {
    const units=a.units+b.units,x=(a.particles[0].x*a.units+b.particles[0].x*b.units)/units;
    const y=(a.particles[0].y*a.units+b.particles[0].y*b.units)/units;
    const held=[...this.bodyDrags(a),...this.bodyDrags(b)].map(d=>({pointerId:d.pointerId,x:d.targetX,y:d.targetY}));
    const sourcePoints=[...mochiRing(a),...mochiRing(b)],sourceIds=[a.id,b.id];
    this.cancelBodyDrags([a,b]);this.removeBodies([a,b]);
    const joined=this.addPudding({units,x,y,noMergeUntil:this.time+.55});if(!joined)return null;
    mochiContour(sourcePoints,x,y,joined.width,joined.height).forEach((p,i)=>{
      const q=joined.particles[i+1];Object.assign(q,{x:p.x,y:p.y,px:p.x,py:p.y,renderX:p.x,renderY:p.y});
    });
    for(const link of joined.mochiLinks){const a=joined.particles[link.a],b=joined.particles[link.b];link.rest=Math.hypot(b.x-a.x,b.y-a.y);}
    joined.mochiMergedAt=this.time;mochiCenter(joined);joined.particles[0].renderX=joined.particles[0].x;joined.particles[0].renderY=joined.particles[0].y;
    this.setExpression(joined,'surprised',.35,'sly',.55);
    for(const d of held)this.beginDrag(d.pointerId,d.x,d.y,{body:joined});
    this.events.push({type:'mochi-joined',sourceIds,resultId:joined.id,units,time:this.time});return joined;
  }
  step(dt=1/60) {
    if(this.paused||this.stopped||!this.bodies.length)return;
    const elapsed=mochiClamp(dt,1/240,1/25);this.time+=elapsed;this.stepCount++;
    for(const body of this.bodies){
      body.contactBodyIds.clear();const held=this.bodyDrags(body).length>0;
      for(const p of body.particles){p.renderX=p.x;p.renderY=p.y;}
      for(const p of mochiRing(body)){
        const damping=held?.91:.97,vx=mochiClamp((p.x-p.px)*damping,-24,24),vy=mochiClamp((p.y-p.py)*damping,-24,24);
        p.px=p.x;p.py=p.y;p.x+=vx;p.y+=vy+this.config.gravity*elapsed*elapsed;
      }
      if(!held){const blend=1-Math.exp(-elapsed/2.35);for(const l of body.mochiLinks)l.rest+=(l.roundRest-l.rest)*blend;}
      for(const d of this.bodyDrags(body)){
        const x=mochiClamp(d.targetX+d.inputOffsetX,5,this.width-5),y=mochiClamp(d.targetY+d.inputOffsetY,5,this.floorY);
        const dx=x-d.resolvedX,dy=y-d.resolvedY,len=Math.hypot(dx,dy),gain=len>24?24/len:1;
        d.resolvedX+=dx*gain;d.resolvedY+=dy*gain;
      }
    }
    const contactMap=new Map();
    for(let iteration=0;iteration<8;iteration++){
      for(const b of this.bodies){this.solveMaterial(b,this.bodyDrags(b).length>0);this.pinGrips(b);this.contain(b);}
      for(const contact of this.solveMochiContacts())contactMap.set(contact.key,contact);
      for(const b of this.bodies)this.contain(b);
    }
    for(const b of this.bodies){
      const drags=this.bodyDrags(b);b.actualStretch=Math.max(1,...b.mochiLinks.filter(l=>l.diameter).map(l=>{
        const a=b.particles[l.a],p=b.particles[l.b];return Math.hypot(p.x-a.x,p.y-a.y)/l.roundRest;
      }));
      b.gestureStretch=Math.max(0,b.actualStretch-1)*.6;
      b.isStretchCrying=drags.length>0&&b.actualStretch>1.48;
      for(const d of drags){const p=mochiPoint(d);p.px=p.x;p.py=p.y;}
      if(!mochiRing(b).every(p=>Number.isFinite(p.x+p.y))||physicsMath.polygonArea(mochiRing(b))<b.restArea*.1)this.recoverMochi(b);
    }
    this.updateMochiFusion([...contactMap.values()],elapsed);this.updateIdleLife(elapsed,[]);
  }
  recoverMochi(body) {
    const c=body.particles[0];c.x=mochiClamp(c.x||this.width*.5,body.width*.54,this.width-body.width*.54);
    c.y=mochiClamp(c.y||this.floorY-body.height,body.height*.55,this.floorY-body.height*.55);
    REST_RING.forEach((r,i)=>{const p=body.particles[i+1],x=c.x+r.x*body.width,y=c.y+r.y*body.height;Object.assign(p,{x,y,px:x,py:y,renderX:x,renderY:y});});
    this.cancelBodyDrags([body]);body.mochiFoot=null;this.events.push({type:'mochi-recovered',bodyId:body.id,time:this.time});
  }
  resize(width,height,floorInset=this.floorInset) {
    if(width===this.width&&height===this.height&&floorInset===this.floorInset)return;
    this.cancelAllDrags();const oldWidth=this.width,oldFloor=this.floorY;
    this.width=Math.max(1,width);this.height=Math.max(1,height);this.floorInset=mochiClamp(floorInset,48,this.height*.42);
    for(const b of this.bodies){
      const c={...b.particles[0]},spec=PUDDING_TIERS[0],unitScale=Math.sqrt(b.units);
      const fit=Math.min(1,this.width*.72/(spec.width*unitScale),this.floorY*.7/(spec.height*unitScale));
      const nextWidth=spec.width*unitScale*fit,ratio=nextWidth/b.width;
      const x=mochiClamp(c.x*this.width/oldWidth,nextWidth*.54,this.width-nextWidth*.54),y=this.floorY-(oldFloor-c.y)*ratio;
      for(const p of b.particles){p.x=x+(p.x-c.x)*ratio;p.y=y+(p.y-c.y)*ratio;p.px=p.renderX=p.x;p.py=p.renderY=p.y;}
      b.width=nextWidth;b.height=spec.height*unitScale*fit;b.restArea*=ratio*ratio;
      for(const l of b.mochiLinks){l.rest*=ratio;l.roundRest*=ratio;}
      this.contain(b);
    }
  }
  snapshot() {
    const snapshot=super.snapshot();snapshot.capacityCount=this.capacityCount;
    snapshot.bodies.forEach((b,i)=>{b.units=this.bodies[i].units;b.isMochi=true;b.foot=this.bodies[i].mochiFoot;});return snapshot;
  }
}

import { loadOptionalImage } from "./assets.js";
import { ToyAudio } from "./audio.js";
import { MergePuddingWorld, PUDDING_COLORS, PUDDING_TIERS } from "./merge-world.js";
import { PuddingRenderer } from "./renderer.js";
import { FixedStepClock } from "./timing.js";
import { FACE_ATLAS, FACE_PARTS } from "./face-atlas.js";

class PuddingToy {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector("#playfield");
    this.controls = root.querySelector("#control-dock");
    this.addButton = root.querySelector("#add-button");
    this.resetButton = root.querySelector("#reset-button");
    this.modeButton = root.querySelector("#mode-button");
    this.soundButton = root.querySelector("#sound-button");
    this.status = root.querySelector("#status");
    this.artStatus = root.querySelector("#art-status");
    this.nextColorPreview = root.querySelector("#next-color-preview");
    this.nextColorName = root.querySelector("#next-color-name");
    this.goalItems = [...root.querySelectorAll("[data-goal-index]")];
    this.goalSample = this.goalItems[0]?.querySelector(".goal-sample");
    this.comboBadge = root.querySelector("#combo-badge");
    this.timerChip = root.querySelector("#timer-chip");
    this.timeResult = root.querySelector("#time-result");
    this.resultDelivered = root.querySelector("#result-delivered");
    this.resultCombo = root.querySelector("#result-combo");
    this.retryTimedButton = root.querySelector("#retry-timed-button");
    this.unlimitedButton = root.querySelector("#unlimited-button");
    this.world = new MergePuddingWorld();
    this.renderer = new PuddingRenderer(this.canvas, {
      debug: new URLSearchParams(location.search).has("debug"),
      lowPower: matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    this.audio = new ToyAudio();
    this.pointers = new Map();
    this.clock = new FixedStepClock();
    this.clock.reset(performance.now());
    this.frameRequest = 0;
    this.running = false;
    this.resizeObserver = null;
    this.lastRenderBodyCount = -1;
    this.lastGoalSignature = "";
    this.lastComboPulseAt = -Infinity;
    this.resultWasVisible = false;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onLostPointerCapture = this.onLostPointerCapture.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.onWindowBlur = this.onWindowBlur.bind(this);
    this.onResize = this.onResize.bind(this);
    this.tick = this.tick.bind(this);
  }

  async initialize() {
    this.attachEvents();
    this.onResize();
    this.world.reset(3);
    this.onResize();
    this.syncNextDropPreview();
    this.syncGoalDisplay();
    this.start();

    const [sprite, faceAtlas] = await Promise.all([loadOptionalImage(), loadOptionalImage(FACE_ATLAS)]);
    if (faceAtlas?.matchesExpectedSize) this.renderer.setFaceParts(faceAtlas.image, FACE_PARTS);
    if (sprite) {
      this.renderer.setSprite(sprite);
      this.artStatus.hidden = true;
      if (!sprite.matchesExpectedSize) {
        this.announce(`画像サイズは ${sprite.image.naturalWidth}×${sprite.image.naturalHeight} です`);
      }
    } else {
      this.artStatus.hidden = false;
      this.announce("画像が見つからないため、確認用の形で表示しています");
    }
  }

  attachEvents() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("lostpointercapture", this.onLostPointerCapture);
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    this.addButton.addEventListener("click", () => {
      const colorIndex = this.world.nextDropColorIndex;
      const body = this.world.addNextDrop();
      if (body) {
        this.announce(`${PUDDING_COLORS[colorIndex].name}ぷりんを追加しました`);
        this.onResize();
      } else {
        this.announce(`ぷりんは${this.world.addLimit}個までです。合体するとまた追加できます`);
      }
      this.syncNextDropPreview();
      this.syncControls();
    });
    this.resetButton.addEventListener("click", () => {
      if (!window.confirm("いまのぷりんを全部しまって、最初からやり直しますか？")) return;
      this.cancelPointers();
      if (this.world.mode === "timed") this.world.startTimedMode(120);
      else this.world.reset(3);
      this.announce(this.world.mode === "timed" ? "2分チャレンジをやり直します" : "3色のぷちぷりんに戻しました");
      this.syncControls();
      this.syncGoalDisplay(true);
      this.onResize();
    });
    this.modeButton.addEventListener("click", () => {
      this.cancelPointers();
      if (this.world.mode === "timed") {
        this.world.startUnlimitedMode();
        this.announce("時間なしの遊びに戻りました");
      } else {
        this.world.startTimedMode(120);
        this.announce("2分チャレンジ、スタート！");
      }
      this.syncControls();
      this.syncGoalDisplay(true);
      this.onResize();
    });
    this.retryTimedButton.addEventListener("click", () => {
      this.world.startTimedMode(120);
      this.syncControls();
      this.syncGoalDisplay(true);
      this.onResize();
    });
    this.unlimitedButton.addEventListener("click", () => {
      this.world.startUnlimitedMode();
      this.syncControls();
      this.syncGoalDisplay(true);
      this.onResize();
    });
    this.soundButton.addEventListener("click", async () => {
      const enabled = await this.audio.toggle();
      this.soundButton.setAttribute("aria-pressed", String(enabled));
      this.soundButton.textContent = enabled ? "🔊 ON" : "🔈 OFF";
      this.announce(enabled ? "音をオンにしました" : "音をオフにしました");
    });

    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("resize", this.onResize, { passive: true });
    window.addEventListener("orientationchange", this.onResize, { passive: true });
    window.visualViewport?.addEventListener("resize", this.onResize, { passive: true });
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.root);
  }

  canvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (this.renderer.width / Math.max(1, rect.width)),
      y: (event.clientY - rect.top) * (this.renderer.height / Math.max(1, rect.height)),
    };
  }

  onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    const point = this.canvasPoint(event);
    if (event.pointerType === "mouse" && event.shiftKey) {
      const children = this.world.splitAt(point.x, point.y);
      if (children) this.announce("およよっ！ ふたつに分かれました");
      return;
    }
    const body = this.world.beginDrag(event.pointerId, point.x, point.y, { time: performance.now() / 1000 });
    if (!body) return;
    this.pointers.set(event.pointerId, {
      body,
      startedAt: performance.now(),
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      maxDistance: 0,
    });
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail if the pointer ended between dispatch and this call.
    }
  }

  onPointerMove(event) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    event.preventDefault();
    const point = this.canvasPoint(event);
    pointer.lastX = point.x;
    pointer.lastY = point.y;
    pointer.maxDistance = Math.max(
      pointer.maxDistance,
      Math.hypot(point.x - pointer.startX, point.y - pointer.startY),
    );
    this.world.moveDrag(event.pointerId, point.x, point.y, { time: performance.now() / 1000 });
  }

  onPointerUp(event) {
    this.finishPointer(event, false);
  }

  onPointerCancel(event) {
    this.finishPointer(event, true);
  }

  onLostPointerCapture(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.finishPointer(event, true);
  }

  finishPointer(event, cancelled) {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    event.preventDefault();
    const point = Number.isFinite(event.clientX) ? this.canvasPoint(event) : { x: pointer.lastX, y: pointer.lastY };
    const duration = performance.now() - pointer.startedAt;
    const releasedBody = this.world.endDrag(event.pointerId, { cancel: cancelled, time: performance.now() / 1000 });
    if (!cancelled && releasedBody && duration <= 260 && pointer.maxDistance <= 13) {
      this.world.poke(releasedBody, point.x, point.y, 1);
    }
    this.pointers.delete(event.pointerId);
    if (this.canvas.hasPointerCapture?.(event.pointerId)) {
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may already have released it.
      }
    }
  }

  cancelPointers() {
    for (const pointerId of [...this.pointers.keys()]) {
      this.world.endDrag(pointerId, { cancel: true });
      this.pointers.delete(pointerId);
      if (this.canvas.hasPointerCapture?.(pointerId)) {
        try { this.canvas.releasePointerCapture(pointerId); } catch { /* Already released. */ }
      }
    }
    this.pointers.clear();
  }

  syncPointerReferences() {
    for (const pointerId of [...this.pointers.keys()]) {
      if (this.world.drags.has(pointerId)) continue;
      this.pointers.delete(pointerId);
      if (this.canvas.hasPointerCapture?.(pointerId)) {
        try { this.canvas.releasePointerCapture(pointerId); } catch { /* Already released. */ }
      }
    }
  }

  onVisibilityChange() {
    if (document.hidden) {
      this.cancelPointers();
      this.world.setPaused(true);
      this.clock.reset(performance.now());
    } else {
      this.world.setPaused(false);
      this.clock.reset(performance.now());
    }
  }

  onWindowBlur() {
    this.cancelPointers();
  }

  onResize() {
    const rect = this.root.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const controlRect = this.controls.getBoundingClientRect();
    const controlsTop = controlRect.height > 0 ? controlRect.top - rect.top : height - 104;
    const floorInset = Math.max(106, height - controlsTop + 26);
    if (this.pointers.size > 0 && (width !== this.world.width || height !== this.world.height
      || floorInset !== this.world.floorInset)) this.cancelPointers();
    this.renderer.resize(width, height, this.world.bodies.length);
    this.world.resize(width, height, floorInset);
    if (this.goalSample) {
      const goalRect = this.goalSample.getBoundingClientRect();
      this.world.setGoalAnchor(
        goalRect.left - rect.left + goalRect.width * 0.5,
        goalRect.top - rect.top + goalRect.height * 0.5,
      );
    }
  }

  syncControls() {
    this.addButton.disabled = this.world.runEnded
      || this.world.bodies.length >= this.world.addLimit;
    this.syncNextDropPreview();
  }

  syncNextDropPreview() {
    const color = PUDDING_COLORS[this.world.nextDropColorIndex] ?? PUDDING_COLORS[0];
    this.nextColorPreview.style.background = color.tint;
    this.nextColorName.textContent = color.name;
  }

  formatTime(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  syncGoalDisplay(force = false) {
    const signature = this.world.goalQueue.map((goal) => goal.version).join(":");
    if (force || signature !== this.lastGoalSignature) {
      this.lastGoalSignature = signature;
      for (let index = 0; index < this.goalItems.length; index += 1) {
        const item = this.goalItems[index];
        const goal = this.world.goalQueue[index];
        item.hidden = !goal;
        if (!goal) continue;
        const color = PUDDING_COLORS[goal.colorIndex];
        const tier = PUDDING_TIERS[goal.tier];
        const sample = item.querySelector(".goal-sample");
        sample.dataset.tier = String(goal.tier);
        sample.style.setProperty("--goal-color", color.tint);
        item.querySelector(".goal-item__name").textContent = `${color.name}・${tier.name}`;
        item.setAttribute("aria-label", `${index === 0 ? "いま" : index === 1 ? "つぎ" : "そのつぎ"}：${color.name}、${tier.name}`);
      }
      requestAnimationFrame(() => this.onResize());
    }

    const comboVisible = this.world.comboCount >= 2
      && this.world.time <= this.world.comboVisibleUntil;
    this.comboBadge.hidden = !comboVisible;
    if (comboVisible) this.comboBadge.textContent = `${this.world.comboCount} COMBO`;
    if (comboVisible && this.world.comboPulseAt !== this.lastComboPulseAt) {
      this.lastComboPulseAt = this.world.comboPulseAt;
      this.comboBadge.classList.remove("is-pulsing");
      void this.comboBadge.offsetWidth;
      this.comboBadge.classList.add("is-pulsing");
    }

    const timed = this.world.mode === "timed";
    this.timerChip.hidden = !timed;
    if (timed) this.timerChip.textContent = this.formatTime(this.world.timeRemaining);
    this.modeButton.textContent = timed ? "∞ 通常" : "⏱ 2分";

    const showResult = timed && this.world.runEnded;
    this.timeResult.hidden = !showResult;
    if (showResult) {
      this.resultDelivered.textContent = String(this.world.deliveredCount);
      this.resultCombo.textContent = String(this.world.highestCombo);
      if (!this.resultWasVisible) this.retryTimedButton.focus({ preventScroll: true });
    }
    this.resultWasVisible = showResult;
  }

  handleWorldEvents(events) {
    for (const event of events) {
      if (event.type === "merged") {
        this.announce("とろ〜ん……ひとつ大きくなりました");
      } else if (event.type === "split") {
        this.announce("およよっ！ ふたつに分かれました");
      } else if (event.type === "burst") {
        this.announce("ぷちーん！ カラメルのきらきらになりました");
      } else if (event.type === "split-blocked") {
        this.announce(event.reason === "smallest"
          ? "ぷちぷりんは、のびるだけです"
          : "これ以上は増やせません");
      } else if (event.type === "goal-collected") {
        this.announce(event.combo >= 2
          ? `${event.combo}コンボ！ つぎの子もおいで〜`
          : "目標の子をくるくる届けました");
      } else if (event.type === "time-ended") {
        this.announce(`2分終了。${event.delivered}個届けました`);
      }
    }
  }

  announce(message) {
    this.status.textContent = "";
    requestAnimationFrame(() => {
      this.status.textContent = message;
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.world.start();
    this.clock.reset(performance.now());
    this.frameRequest = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    this.world.stop();
    this.cancelPointers();
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
  }

  tick(now) {
    if (!this.running) return;
    let frame = { alpha: 1 };
    if (!this.world.paused) {
      frame = this.clock.advance(now, (step) => this.world.step(step));
    } else {
      this.clock.reset(now);
    }

    if (this.lastRenderBodyCount !== this.world.bodies.length) {
      this.lastRenderBodyCount = this.world.bodies.length;
      this.syncControls();
    }
    this.syncPointerReferences();
    const events = this.world.consumeEvents();
    this.handleWorldEvents(events);
    this.audio.handle(events);
    if (events.some((event) => event.type === "time-ended")) this.syncControls();
    this.syncGoalDisplay();
    this.renderer.render(this.world, frame.alpha);
    this.frameRequest = requestAnimationFrame(this.tick);
  }

  snapshot() {
    return this.world.snapshot();
  }

  destroy() {
    this.stop();
    this.resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("blur", this.onWindowBlur);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    window.visualViewport?.removeEventListener("resize", this.onResize);
  }
}

const game = new PuddingToy(document.querySelector("#game"));
game.initialize();
globalThis.__puddingToy = game;

export { PuddingToy };

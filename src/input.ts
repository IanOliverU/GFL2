// Keyboard + mouse input with pointer-lock awareness and stuck-key guards.
export class Input {
  keys = new Set<string>();
  mouseDown = false;
  rmbDown = false;
  lookDX = 0; lookDY = 0;
  wheel = 0;
  pressed = new Set<string>(); // edge-triggered, consumed each fixed step
  locked = false;
  enabled = true;
  private el: HTMLElement | null = null;
  private onLockChange: (() => void) | null = null;
  private onLockError: (() => void) | null = null;
  private blurHandler = (): void => { this.releaseAll(); };

  attach(el: HTMLElement, onLockChange?: () => void, onLockError?: () => void): void {
    this.el = el;
    this.onLockChange = onLockChange ?? null;
    this.onLockError = onLockError ?? null;
    window.addEventListener("keydown", this.kd);
    window.addEventListener("keyup", this.ku);
    window.addEventListener("blur", this.blurHandler);
    document.addEventListener("pointerlockchange", this.plc);
    document.addEventListener("pointerlockerror", this.ple);
    document.addEventListener("mousemove", this.mm);
    document.addEventListener("mousedown", this.md);
    document.addEventListener("mouseup", this.mu);
    document.addEventListener("visibilitychange", this.vis);
  }

  detach(): void {
    window.removeEventListener("keydown", this.kd);
    window.removeEventListener("keyup", this.ku);
    window.removeEventListener("blur", this.blurHandler);
    document.removeEventListener("pointerlockchange", this.plc);
    document.removeEventListener("pointerlockerror", this.ple);
    document.removeEventListener("mousemove", this.mm);
    document.removeEventListener("mousedown", this.md);
    document.removeEventListener("mouseup", this.mu);
    document.removeEventListener("visibilitychange", this.vis);
  }

  private kd = (e: KeyboardEvent): void => {
    if (!this.enabled || !this.locked) return;
    if (e.code === "Tab") e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    this.pressed.add(e.code);
  };
  private ku = (e: KeyboardEvent): void => { this.keys.delete(e.code); };
  private plc = (): void => {
    this.locked = document.pointerLockElement === this.el;
    if (!this.locked) this.releaseAll();
    this.onLockChange?.();
  };
  private ple = (): void => {
    this.releaseAll();
    this.onLockError?.();
  };
  private mm = (e: MouseEvent): void => {
    if (!this.locked || !this.enabled) return;
    this.lookDX += e.movementX;
    this.lookDY += e.movementY;
  };
  private md = (e: MouseEvent): void => {
    if (!this.locked || !this.enabled) return;
    if (e.button === 0) this.mouseDown = true;
    if (e.button === 2) this.rmbDown = true;
  };
  private mu = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) this.rmbDown = false;
  };
  private vis = (): void => { if (document.hidden) this.releaseAll(); };

  requestLock(): void {
    try {
      const result = this.el?.requestPointerLock() as unknown;
      if (result instanceof Promise) void result.catch(this.ple);
    } catch { this.ple(); }
  }
  exitLock(): void {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignore */ }
  }

  releaseAll(): void {
    this.keys.clear();
    this.mouseDown = false;
    this.rmbDown = false;
    this.lookDX = 0; this.lookDY = 0;
    this.pressed.clear();
    this.wheel = 0;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return r;
  }

  wasPressed(code: string): boolean { return this.pressed.has(code); }
  endStep(): void { this.pressed.clear(); this.wheel = 0; }

  moveAxes(): { x: number; z: number } {
    let x = 0, z = 0;
    if (this.keys.has("KeyW")) z += 1;
    if (this.keys.has("KeyS")) z -= 1;
    if (this.keys.has("KeyA")) x -= 1;
    if (this.keys.has("KeyD")) x += 1;
    return { x, z };
  }
}

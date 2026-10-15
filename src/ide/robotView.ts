import type { Dir, Robot, World } from '../lang/robot';
import { WORLDS } from './examples';

type Tool = 'wall' | 'goal' | 'robot';

/** The robot grid: draws the world, animates the robot, and lets you edit the world when nothing is running. */
export class RobotView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private robot: Robot | null = null;
  private tool: Tool = 'wall';
  private pose = { x: 0, y: 0, angle: 0 };
  private target = { x: 0, y: 0, angle: 0 };
  private lastDir: Dir = 0;
  private crash: { x: number; y: number; t: number } | null = null;
  private celebrate = 0;
  private editable = true;
  private status: HTMLElement;
  private raf = 0;
  private presetSel: HTMLSelectElement;

  constructor(public world: World, private onChange: (w: World) => void) {
    this.el = document.createElement('div');
    this.el.className = 'robot';
    this.el.innerHTML = `
      <div class="robot-bar">
        <select class="preset" title="Load a grid"></select>
        <div class="seg tools" role="group" aria-label="Edit tool">
          <button data-tool="wall" title="Click squares to add/remove walls">▦ Wall</button>
          <button data-tool="goal" title="Click a square to put the goal there">◼ Goal</button>
          <button data-tool="robot" title="Click a square to place the robot; click it again to turn it">▲ Robot</button>
        </div>
        <div class="sizer" title="Grid size">
          <button data-size="w-">−</button><span class="size"></span><button data-size="w+">+</button>
          <span class="x">×</span>
          <button data-size="h-">−</button><span class="size-h"></span><button data-size="h+">+</button>
        </div>
      </div>
      <canvas></canvas>
      <div class="robot-status"></div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.status = this.el.querySelector('.robot-status')!;
    this.presetSel = this.el.querySelector('.preset')!;
    this.presetSel.innerHTML = `<option value="">Load a grid…</option>` + Object.keys(WORLDS).map((k) => `<option>${k}</option>`).join('');
    this.presetSel.onchange = () => {
      const w = WORLDS[this.presetSel.value];
      if (w) this.setWorld(structuredClone(w), true);
      this.presetSel.value = '';
    };
    this.el.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
      b.onclick = () => { this.tool = b.dataset.tool as Tool; this.syncBar(); };
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) => {
      b.onclick = () => this.resize(b.dataset.size!);
    });
    this.canvas.addEventListener('pointerdown', (e) => this.click(e));
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    this.setWorld(world, false);
  }

  setWorld(w: World, notify: boolean) {
    this.world = w;
    this.robot = null;
    this.crash = null;
    this.celebrate = 0;
    this.snap(w.start.x, w.start.y, w.start.dir);
    this.syncBar();
    this.draw();
    if (notify) this.onChange(w);
  }

  /** Follow a live robot (null = show the world's starting position). */
  attach(robot: Robot | null) {
    this.robot = robot;
    this.crash = null;
    this.celebrate = 0;
    if (!robot) this.snap(this.world.start.x, this.world.start.y, this.world.start.dir);
    else this.snap(robot.x, robot.y, robot.dir);
    this.kick();
  }

  setEditable(on: boolean) {
    this.editable = on;
    this.el.classList.toggle('locked', !on);
  }

  /** Called after the VM runs: pick up the robot's new position. `instant` skips the animation. */
  update(instant = false) {
    const r = this.robot;
    if (!r) return;
    if (r.dir !== this.lastDir) {
      let d = r.dir - this.lastDir;
      if (d === 3) d = -1;
      if (d === -3) d = 1;
      this.target.angle += d * 90;
      this.lastDir = r.dir;
    }
    this.target.x = r.x;
    this.target.y = r.y;
    const crash = r.events[r.events.length - 1];
    if (crash?.type === 'crash' && !this.crash) this.crash = { x: crash.x, y: crash.y, t: performance.now() };
    if (r.atGoal() && !this.celebrate) this.celebrate = performance.now();
    if (instant) this.pose = { ...this.target };
    this.kick();
  }

  private snap(x: number, y: number, dir: Dir) {
    this.lastDir = dir;
    this.target = { x, y, angle: dir * 90 };
    this.pose = { ...this.target };
  }

  private syncBar() {
    this.el.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === this.tool));
    this.el.querySelector('.size')!.textContent = String(this.world.width);
    this.el.querySelector('.size-h')!.textContent = String(this.world.height);
    const g = this.world.goal;
    this.status.textContent = this.editable
      ? `${this.world.width}×${this.world.height} grid · robot at column ${this.world.start.x + 1}, row ${this.world.start.y + 1}${g ? '' : ' · no goal'}`
      : '';
  }

  private resize(how: string) {
    const w = structuredClone(this.world);
    if (how === 'w+') w.width = Math.min(15, w.width + 1);
    if (how === 'w-') w.width = Math.max(2, w.width - 1);
    if (how === 'h+') w.height = Math.min(15, w.height + 1);
    if (how === 'h-') w.height = Math.max(2, w.height - 1);
    w.walls = w.walls.filter((k) => { const [x, y] = k.split(',').map(Number); return x < w.width && y < w.height; });
    w.start.x = Math.min(w.start.x, w.width - 1);
    w.start.y = Math.min(w.start.y, w.height - 1);
    w.walls = w.walls.filter((k) => k !== `${w.start.x},${w.start.y}`);
    if (w.goal && (w.goal.x >= w.width || w.goal.y >= w.height)) w.goal = null;
    this.setWorld(w, true);
  }

  private geometry() {
    const { width: cw, height: ch } = this.canvas.getBoundingClientRect();
    const cell = Math.floor(Math.min((cw - 16) / this.world.width, (ch - 16) / this.world.height));
    const ox = Math.round((cw - cell * this.world.width) / 2);
    const oy = Math.round((ch - cell * this.world.height) / 2);
    return { cw, ch, cell: Math.max(cell, 4), ox, oy };
  }

  private click(e: PointerEvent) {
    if (!this.editable) return;
    const r = this.canvas.getBoundingClientRect();
    const { cell, ox, oy } = this.geometry();
    const x = Math.floor((e.clientX - r.left - ox) / cell);
    const y = Math.floor((e.clientY - r.top - oy) / cell);
    if (x < 0 || y < 0 || x >= this.world.width || y >= this.world.height) return;
    const w = structuredClone(this.world);
    const key = `${x},${y}`;
    const isStart = w.start.x === x && w.start.y === y;
    if (this.tool === 'wall') {
      if (isStart) return;
      w.walls = w.walls.includes(key) ? w.walls.filter((k) => k !== key) : [...w.walls, key];
      if (w.goal && w.goal.x === x && w.goal.y === y) w.goal = null;
    } else if (this.tool === 'goal') {
      w.goal = w.goal && w.goal.x === x && w.goal.y === y ? null : { x, y };
      w.walls = w.walls.filter((k) => k !== key);
    } else {
      if (isStart) w.start.dir = ((w.start.dir + 1) % 4) as Dir;
      else { w.start = { x, y, dir: w.start.dir }; w.walls = w.walls.filter((k) => k !== key); }
    }
    this.setWorld(w, true);
  }

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
    // rAF is paused in hidden tabs; make sure the final state is still drawn
    this.draw();
  }

  private frame() {
    this.raf = 0;
    const k = 0.25;
    const p = this.pose, t = this.target;
    p.x += (t.x - p.x) * k;
    p.y += (t.y - p.y) * k;
    p.angle += (t.angle - p.angle) * k;
    const settled = Math.abs(t.x - p.x) < 0.01 && Math.abs(t.y - p.y) < 0.01 && Math.abs(t.angle - p.angle) < 0.5;
    if (settled) this.pose = { ...t };
    this.draw();
    const now = performance.now();
    const animating = !settled || (this.crash && now - this.crash.t < 1200) || (this.celebrate && now - this.celebrate < 1500);
    if (animating) this.raf = requestAnimationFrame(() => this.frame());
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const { cw, ch, cell, ox, oy } = this.geometry();
    if (cw === 0) return;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    const c = this.ctx;
    const css = getComputedStyle(this.el);
    const col = (n: string) => css.getPropertyValue(n).trim();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cw, ch);
    const W = this.world;
    const walls = new Set(W.walls);

    // cells
    for (let y = 0; y < W.height; y++) {
      for (let x = 0; x < W.width; x++) {
        const px = ox + x * cell, py = oy + y * cell;
        c.fillStyle = walls.has(`${x},${y}`) ? col('--grid-wall') : col('--grid-open');
        c.fillRect(px, py, cell, cell);
        if (walls.has(`${x},${y}`)) {
          // hatch the walls so they read as blocked, like the exam's black squares
          c.save();
          c.beginPath();
          c.rect(px, py, cell, cell);
          c.clip();
          c.strokeStyle = col('--grid-hatch');
          c.lineWidth = 1;
          for (let d = -cell; d < cell; d += 6) {
            c.beginPath(); c.moveTo(px + d, py + cell); c.lineTo(px + d + cell, py); c.stroke();
          }
          c.restore();
        }
      }
    }
    if (W.goal) {
      const t = this.celebrate ? (performance.now() - this.celebrate) / 1500 : 1;
      c.fillStyle = col('--grid-goal');
      const inset = cell * 0.08;
      c.fillRect(ox + W.goal.x * cell + inset, oy + W.goal.y * cell + inset, cell - inset * 2, cell - inset * 2);
      if (t < 1) {
        c.strokeStyle = col('--ok');
        c.lineWidth = 3;
        const g = cell * (0.5 + t);
        c.globalAlpha = 1 - t;
        c.strokeRect(ox + (W.goal.x + 0.5) * cell - g / 2, oy + (W.goal.y + 0.5) * cell - g / 2, g, g);
        c.globalAlpha = 1;
      }
    }
    // grid lines
    c.strokeStyle = col('--grid-line');
    c.lineWidth = 1;
    for (let x = 0; x <= W.width; x++) { c.beginPath(); c.moveTo(ox + x * cell + 0.5, oy); c.lineTo(ox + x * cell + 0.5, oy + W.height * cell); c.stroke(); }
    for (let y = 0; y <= W.height; y++) { c.beginPath(); c.moveTo(ox, oy + y * cell + 0.5); c.lineTo(ox + W.width * cell, oy + y * cell + 0.5); c.stroke(); }

    // trail
    if (this.robot) {
      c.fillStyle = col('--accent');
      c.globalAlpha = 0.35;
      for (const [x, y] of this.robot.trail) {
        c.beginPath();
        c.arc(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell, Math.max(2, cell * 0.07), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    // crash flash
    if (this.crash) {
      const t = Math.min(1, (performance.now() - this.crash.t) / 1200);
      c.strokeStyle = col('--err');
      c.lineWidth = 3;
      c.globalAlpha = 1 - t * 0.6;
      const { x, y } = this.crash;
      const px = ox + x * cell, py = oy + y * cell;
      c.beginPath(); c.moveTo(px + cell * 0.25, py + cell * 0.25); c.lineTo(px + cell * 0.75, py + cell * 0.75);
      c.moveTo(px + cell * 0.75, py + cell * 0.25); c.lineTo(px + cell * 0.25, py + cell * 0.75); c.stroke();
      c.globalAlpha = 1;
    }
    // robot: a triangle pointing the way it faces (as on the exam)
    const p = this.pose;
    c.save();
    c.translate(ox + (p.x + 0.5) * cell, oy + (p.y + 0.5) * cell);
    c.rotate((p.angle * Math.PI) / 180);
    const s = cell * 0.34;
    c.beginPath();
    c.moveTo(0, -s);
    c.lineTo(s * 0.85, s * 0.75);
    c.lineTo(-s * 0.85, s * 0.75);
    c.closePath();
    c.fillStyle = this.crash ? col('--err') : col('--robot');
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = col('--paper');
    c.stroke();
    c.restore();
  }
}

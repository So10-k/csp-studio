import { RuntimeError } from './errors';

/** 0 = up, 1 = right, 2 = down, 3 = left */
export type Dir = 0 | 1 | 2 | 3;

export interface World {
  width: number;
  height: number;
  /** blocked squares, as "x,y" (x = column from the left, y = row from the top, 0-based) */
  walls: string[];
  start: { x: number; y: number; dir: Dir };
  goal: { x: number; y: number } | null;
}

export const DELTA: Record<Dir, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };
const RELATIVE: Record<string, number> = { forward: 0, right: 1, backward: 2, left: 3 };

export type RobotEvent =
  | { type: 'move'; x: number; y: number }
  | { type: 'turn'; dir: Dir; delta: 1 | -1 }
  | { type: 'crash'; x: number; y: number }
  | { type: 'goal' };

/** The robot on its grid: follows the reference sheet's MOVE_FORWARD / ROTATE_* / CAN_MOVE rules. */
export class Robot {
  x: number;
  y: number;
  dir: Dir;
  private walls: Set<string>;
  readonly events: RobotEvent[] = [];
  /** squares visited, in order (for drawing the trail) */
  readonly trail: [number, number][] = [];

  constructor(public world: World) {
    this.x = world.start.x;
    this.y = world.start.y;
    this.dir = world.start.dir;
    this.walls = new Set(world.walls);
    this.trail.push([this.x, this.y]);
  }

  open(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.world.width && y < this.world.height && !this.walls.has(`${x},${y}`);
  }

  canMove(direction: string): boolean {
    const rel = RELATIVE[direction];
    if (rel === undefined) {
      throw new RuntimeError(`CAN_MOVE needs left, right, forward or backward, not "${direction}".`);
    }
    const [dx, dy] = DELTA[((this.dir + rel) % 4) as Dir];
    return this.open(this.x + dx, this.y + dy);
  }

  moveForward() {
    const [dx, dy] = DELTA[this.dir];
    const nx = this.x + dx, ny = this.y + dy;
    if (!this.open(nx, ny)) {
      this.events.push({ type: 'crash', x: nx, y: ny });
      const why = nx < 0 || ny < 0 || nx >= this.world.width || ny >= this.world.height ? 'off the edge of the grid' : 'into a blocked square';
      throw new RuntimeError(`The robot can't move ${why}, so it stays where it is and the program terminates.`);
    }
    this.x = nx;
    this.y = ny;
    this.trail.push([nx, ny]);
    this.events.push({ type: 'move', x: nx, y: ny });
    if (this.atGoal()) this.events.push({ type: 'goal' });
  }

  rotate(delta: 1 | -1) {
    this.dir = ((this.dir + delta + 4) % 4) as Dir;
    this.events.push({ type: 'turn', dir: this.dir, delta });
  }

  atGoal(): boolean {
    return !!this.world.goal && this.world.goal.x === this.x && this.world.goal.y === this.y;
  }
}

import { compileSource } from '../lang/compiler';
import { Robot } from '../lang/robot';
import { VM } from '../lang/vm';
import { EXAMPLES, WORLDS } from './examples';

describe('examples', () => {
  it.each(EXAMPLES.map((e) => [e.name, e] as const))('%s runs without errors', (_, ex) => {
    const robot = ex.world ? new Robot(WORLDS[ex.world]) : undefined;
    const vm = new VM(compileSource(ex.code), { display: () => {}, robot, random: () => 0.5 });
    let guesses = 0;
    for (let i = 0; i < 100 && !vm.done; i++) {
      vm.run(1e5);
      if (vm.status === 'input') vm.provideInput(++guesses);
    }
    expect(vm.error?.message ?? null).toBeNull();
    expect(vm.status).toBe('done');
    if (ex.world) expect(robot!.trail.some(([x, y]) => x === WORLDS[ex.world!].goal!.x && y === WORLDS[ex.world!].goal!.y)).toBe(true);
  });
});

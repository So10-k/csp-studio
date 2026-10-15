import { parse } from '../../lang/parser';
import { printProgram } from '../../lang/printer';
import { EXAMPLES } from '../examples';
import { BlockError, jsonToProgram, programToJson } from './convert';

const roundTrip = (src: string) => printProgram(jsonToProgram(programToJson(parse(src))));

describe('blocks ⇄ AST', () => {
  it.each(EXAMPLES.map((e) => [e.name, e.code]))('%s survives text → blocks → text', (_, code) => {
    expect(roundTrip(code)).toBe(printProgram(parse(code)));
  });
  it('handles every construct', () => {
    const src = `a[2] ← NOT (x ≠ 3) OR y AND z
IF (CAN_MOVE(left)) { ROTATE_LEFT() } ELSE { MOVE_FORWARD() }
REPEAT UNTIL (i ≥ LENGTH(l)) { INSERT(l, 1, RANDOM(1, 9)) REMOVE(l, 2) }
foo(1, [2, [3]], "s", true, -x)
v ← bar() + INPUT() MOD 2
PROCEDURE bar() { RETURN() }
PROCEDURE foo(a, b, c, d, e) { RETURN(a) }`;
    expect(roundTrip(src)).toBe(printProgram(parse(src)));
  });
  it('keeps statement ids as block ids', () => {
    const p = parse('x ← 1\nDISPLAY(x)');
    const back = jsonToProgram(programToJson(p));
    expect(back.body.map((s) => s.id)).toEqual(p.body.map((s) => s.id));
  });
  it('orders stacks top to bottom', () => {
    const ws = programToJson(parse('PROCEDURE f() { }\nx ← 1'));
    ws.blocks!.blocks.reverse();
    expect(jsonToProgram(ws).body.map((s) => s.kind)).toEqual(['proc', 'assign']);
  });
  it('reports empty slots with the block id', () => {
    expect(() => jsonToProgram({ blocks: { languageVersion: 0, blocks: [{ type: 'csp_display', id: 'B1' }] } })).toThrow(BlockError);
    try {
      jsonToProgram({ blocks: { languageVersion: 0, blocks: [{ type: 'csp_display', id: 'B1' }] } });
    } catch (e) {
      expect((e as BlockError).blockId).toBe('B1');
    }
  });
  it('rejects bad names', () => {
    expect(() => jsonToProgram({ blocks: { languageVersion: 0, blocks: [{ type: 'csp_assign', id: 'B', fields: { VAR: 'my var' }, inputs: { VALUE: { shadow: { type: 'csp_num', fields: { NUM: 1 } } } } }] } })).toThrow(/isn't a valid variable name/);
  });
  it('uses shadow blocks', () => {
    const p = jsonToProgram({ blocks: { languageVersion: 0, blocks: [{ type: 'csp_assign', id: 'B', fields: { VAR: 'n' }, inputs: { VALUE: { shadow: { type: 'csp_num', fields: { NUM: 4 } } } } }] } });
    expect(printProgram(p)).toBe('n ← 4\n');
  });
});

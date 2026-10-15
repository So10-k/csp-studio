import * as Blockly from 'blockly/core';

/** Block shapes mirror the reference sheet's block form. Type checks are left to the compiler (like the exam). */
const S = { previousStatement: null, nextStatement: null } as const;
const V = { output: null } as const;
const body = (name = 'BODY') => ({ message1: '%1', args1: [{ type: 'input_statement', name }] });
const val = (name: string) => ({ type: 'input_value', name });

const JSON_BLOCKS = [
  // variables & values
  { type: 'csp_assign', message0: '%1 ← %2', args0: [{ type: 'field_input', name: 'VAR', text: 'x' }, val('VALUE')], ...S, style: 'var_blocks', inputsInline: true, tooltip: 'Store a value in a variable.' },
  { type: 'csp_var', message0: '%1', args0: [{ type: 'field_input', name: 'VAR', text: 'x' }], ...V, style: 'var_blocks', tooltip: 'The value stored in a variable.' },
  { type: 'csp_num', message0: '%1', args0: [{ type: 'field_number', name: 'NUM', value: 0 }], ...V, style: 'math_blocks' },
  { type: 'csp_str', message0: '"%1"', args0: [{ type: 'field_input', name: 'TEXT', text: 'text' }], ...V, style: 'text_blocks' },
  { type: 'csp_bool', message0: '%1', args0: [{ type: 'field_dropdown', name: 'BOOL', options: [['true', 'TRUE'], ['false', 'FALSE']] }], ...V, style: 'logic_blocks' },
  // math
  {
    type: 'csp_arith', message0: '%1 %2 %3',
    args0: [val('A'), { type: 'field_dropdown', name: 'OP', options: [['+', '+'], ['-', '-'], ['*', '*'], ['/', '/'], ['MOD', 'MOD']] }, val('B')],
    ...V, inputsInline: true, style: 'math_blocks',
  },
  { type: 'csp_neg', message0: '- %1', args0: [val('A')], ...V, inputsInline: true, style: 'math_blocks' },
  { type: 'csp_random', message0: 'RANDOM ( %1 , %2 )', args0: [val('A'), val('B')], ...V, inputsInline: true, style: 'math_blocks', tooltip: 'A random whole number from a to b, inclusive.' },
  // logic
  {
    type: 'csp_compare', message0: '%1 %2 %3',
    args0: [val('A'), { type: 'field_dropdown', name: 'OP', options: [['=', '='], ['≠', '≠'], ['<', '<'], ['>', '>'], ['≤', '≤'], ['≥', '≥']] }, val('B')],
    ...V, inputsInline: true, style: 'logic_blocks',
  },
  { type: 'csp_logic', message0: '%1 %2 %3', args0: [val('A'), { type: 'field_dropdown', name: 'OP', options: [['AND', 'AND'], ['OR', 'OR']] }, val('B')], ...V, inputsInline: true, style: 'logic_blocks' },
  { type: 'csp_not', message0: 'NOT %1', args0: [val('A')], ...V, inputsInline: true, style: 'logic_blocks' },
  // control
  { type: 'csp_if', message0: 'IF ( %1 )', args0: [val('COND')], ...body('THEN'), ...S, style: 'control_blocks' },
  {
    type: 'csp_if_else', message0: 'IF ( %1 )', args0: [val('COND')], ...body('THEN'),
    message2: 'ELSE', message3: '%1', args3: [{ type: 'input_statement', name: 'ELSE' }], ...S, style: 'control_blocks',
  },
  { type: 'csp_repeat', message0: 'REPEAT %1 TIMES', args0: [val('COUNT')], ...body(), ...S, inputsInline: true, style: 'control_blocks' },
  { type: 'csp_until', message0: 'REPEAT UNTIL ( %1 )', args0: [val('COND')], ...body(), ...S, style: 'control_blocks' },
  {
    type: 'csp_foreach', message0: 'FOR EACH %1 IN %2', args0: [{ type: 'field_input', name: 'ITEM', text: 'item' }, val('LIST')],
    ...body(), ...S, inputsInline: true, style: 'control_blocks',
  },
  // lists
  { type: 'csp_index', message0: '%1 [ %2 ]', args0: [val('LIST'), val('INDEX')], ...V, inputsInline: true, style: 'list_blocks', tooltip: 'The element at an index (the first element is 1).' },
  { type: 'csp_assign_index', message0: '%1 [ %2 ] ← %3', args0: [val('LIST'), val('INDEX'), val('VALUE')], ...S, inputsInline: true, style: 'list_blocks' },
  { type: 'csp_length', message0: 'LENGTH ( %1 )', args0: [val('LIST')], ...V, inputsInline: true, style: 'list_blocks' },
  { type: 'csp_append', message0: 'APPEND ( %1 , %2 )', args0: [val('LIST'), val('VALUE')], ...S, inputsInline: true, style: 'list_blocks' },
  { type: 'csp_insert', message0: 'INSERT ( %1 , %2 , %3 )', args0: [val('LIST'), val('INDEX'), val('VALUE')], ...S, inputsInline: true, style: 'list_blocks' },
  { type: 'csp_remove', message0: 'REMOVE ( %1 , %2 )', args0: [val('LIST'), val('INDEX')], ...S, inputsInline: true, style: 'list_blocks' },
  // procedures
  {
    type: 'csp_proc', message0: 'PROCEDURE %1 ( %2 )',
    args0: [{ type: 'field_input', name: 'NAME', text: 'myProcedure' }, { type: 'field_input', name: 'PARAMS', text: '' }],
    ...body(), style: 'proc_blocks', tooltip: 'Define a procedure. Parameters are separated by commas.',
  },
  { type: 'csp_return', message0: 'RETURN ( %1 )', args0: [val('VALUE')], ...S, inputsInline: true, style: 'proc_blocks' },
  // input / output
  { type: 'csp_display', message0: 'DISPLAY ( %1 )', args0: [val('VALUE')], ...S, inputsInline: true, style: 'io_blocks' },
  { type: 'csp_input', message0: 'INPUT ( )', ...V, style: 'io_blocks' },
  // robot
  { type: 'csp_move', message0: 'MOVE_FORWARD ( )', ...S, style: 'robot_blocks' },
  { type: 'csp_left', message0: 'ROTATE_LEFT ( )', ...S, style: 'robot_blocks' },
  { type: 'csp_right', message0: 'ROTATE_RIGHT ( )', ...S, style: 'robot_blocks' },
  {
    type: 'csp_can_move', message0: 'CAN_MOVE ( %1 )',
    args0: [{ type: 'field_dropdown', name: 'DIR', options: [['forward', 'forward'], ['left', 'left'], ['right', 'right'], ['backward', 'backward']] }],
    ...V, style: 'robot_blocks',
  },
];

const icon = (path: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7.5" fill="rgba(255,255,255,.85)"/><path d="${path}" stroke="#333" stroke-width="2" stroke-linecap="round"/></svg>`);
const PLUS = icon('M8 4v8M4 8h8');
const MINUS = icon('M4 8h8');

interface ArityBlock extends Blockly.BlockSvg {
  n: number;
  updateShape(n: number): void;
  setArity(n: number): void;
}

/** Shared by the list literal and procedure calls: a row of ARG0..ARGn-1 inputs with + / − buttons. */
function arityMixin(open: string, close: string, sep: string) {
  return {
    n: 0,
    updateShape(this: ArityBlock, n: number) {
      for (let k = n; this.getInput(`ARG${k}`); k++) this.removeInput(`ARG${k}`);
      for (let k = 0; k < n; k++) {
        if (this.getInput(`ARG${k}`)) continue;
        const input = this.appendValueInput(`ARG${k}`);
        if (k > 0) input.appendField(sep);
        this.moveInputBefore(`ARG${k}`, 'TAIL');
      }
      this.n = n;
      const minus = this.getField('MINUS');
      if (minus) (minus as Blockly.FieldImage).setVisible(n > 0);
    },
    setArity(this: ArityBlock, n: number) {
      const old = JSON.stringify({ n: this.n });
      this.updateShape(Math.max(0, Math.min(12, n)));
      Blockly.Events.fire(new (Blockly.Events.get(Blockly.Events.BLOCK_CHANGE))(this, 'mutation', null, old, JSON.stringify({ n: this.n })));
    },
    saveExtraState(this: ArityBlock) { return { n: this.n }; },
    loadExtraState(this: ArityBlock, s: { n: number }) { this.updateShape(s.n); },
    tail(this: ArityBlock) {
      this.appendDummyInput('TAIL')
        .appendField(close)
        .appendField(new Blockly.FieldImage(PLUS, 16, 16, 'add', () => this.setArity(this.n + 1)), 'PLUS')
        .appendField(new Blockly.FieldImage(MINUS, 16, 16, 'remove', () => this.setArity(this.n - 1)), 'MINUS');
      void open;
    },
  };
}

function defineArity() {
  const list = arityMixin('[', ']', ',');
  Blockly.Blocks['csp_list'] = {
    ...list,
    init(this: ArityBlock & { tail(): void }) {
      this.appendDummyInput('HEAD').appendField('[');
      this.tail();
      this.setOutput(true);
      this.setInputsInline(true);
      this.setStyle('list_blocks');
      this.setTooltip('A list. Use + and − to change how many items it has.');
      this.updateShape(3);
    },
  };

  for (const asValue of [false, true]) {
    const call = arityMixin('(', ')', ',');
    Blockly.Blocks[asValue ? 'csp_call_value' : 'csp_call'] = {
      ...call,
      init(this: ArityBlock & { tail(): void }) {
        const name = new Blockly.FieldTextInput('myProcedure', (v: string) => {
          // match the number of inputs to a procedure of that name, if one is defined
          const ws = this.workspace;
          const def = ws?.getBlocksByType('csp_proc', false).find((b) => b.getFieldValue('NAME') === v);
          if (def) {
            const params = String(def.getFieldValue('PARAMS')).split(',').map((p) => p.trim()).filter(Boolean);
            if (params.length !== this.n) setTimeout(() => this.setArity(params.length));
          }
          return v;
        });
        this.appendDummyInput('HEAD').appendField(name, 'NAME').appendField('(');
        this.tail();
        if (asValue) this.setOutput(true);
        else { this.setPreviousStatement(true); this.setNextStatement(true); }
        this.setInputsInline(true);
        this.setStyle('proc_blocks');
        this.setTooltip('Call a procedure. Use + and − to change how many arguments it gets.');
        this.updateShape(0);
      },
    };
  }
}

let defined = false;
export function defineBlocks() {
  if (defined) return;
  defined = true;
  Blockly.common.defineBlocksWithJsonArray(JSON_BLOCKS);
  defineArity();
}

const shadowNum = (n: number) => ({ shadow: { type: 'csp_num', fields: { NUM: n } } });
const shadowVar = (v: string) => ({ shadow: { type: 'csp_var', fields: { VAR: v } } });
const shadowBool = { shadow: { type: 'csp_bool', fields: { BOOL: 'TRUE' } } };

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category', name: 'Variables', categorystyle: 'var_category',
      contents: [
        { kind: 'block', type: 'csp_assign', inputs: { VALUE: shadowNum(0) } },
        { kind: 'block', type: 'csp_var' },
        { kind: 'block', type: 'csp_num' },
        { kind: 'block', type: 'csp_str' },
        { kind: 'block', type: 'csp_bool' },
      ],
    },
    {
      kind: 'category', name: 'Math', categorystyle: 'math_category',
      contents: [
        { kind: 'block', type: 'csp_arith', inputs: { A: shadowNum(1), B: shadowNum(1) } },
        { kind: 'block', type: 'csp_arith', fields: { OP: 'MOD' }, inputs: { A: shadowNum(10), B: shadowNum(3) } },
        { kind: 'block', type: 'csp_neg', inputs: { A: shadowVar('x') } },
        { kind: 'block', type: 'csp_random', inputs: { A: shadowNum(1), B: shadowNum(10) } },
      ],
    },
    {
      kind: 'category', name: 'Logic', categorystyle: 'logic_category',
      contents: [
        { kind: 'block', type: 'csp_compare', inputs: { A: shadowVar('x'), B: shadowNum(0) } },
        { kind: 'block', type: 'csp_logic', inputs: { A: shadowBool, B: shadowBool } },
        { kind: 'block', type: 'csp_not', inputs: { A: shadowBool } },
        { kind: 'block', type: 'csp_bool' },
      ],
    },
    {
      kind: 'category', name: 'Control', categorystyle: 'control_category',
      contents: [
        { kind: 'block', type: 'csp_if', inputs: { COND: shadowBool } },
        { kind: 'block', type: 'csp_if_else', inputs: { COND: shadowBool } },
        { kind: 'block', type: 'csp_repeat', inputs: { COUNT: shadowNum(4) } },
        { kind: 'block', type: 'csp_until', inputs: { COND: shadowBool } },
        { kind: 'block', type: 'csp_foreach', inputs: { LIST: shadowVar('aList') } },
      ],
    },
    {
      kind: 'category', name: 'Lists', categorystyle: 'list_category',
      contents: [
        { kind: 'block', type: 'csp_list', extraState: { n: 3 }, inputs: { ARG0: shadowNum(1), ARG1: shadowNum(2), ARG2: shadowNum(3) } },
        { kind: 'block', type: 'csp_index', inputs: { LIST: shadowVar('aList'), INDEX: shadowNum(1) } },
        { kind: 'block', type: 'csp_assign_index', inputs: { LIST: shadowVar('aList'), INDEX: shadowNum(1), VALUE: shadowNum(0) } },
        { kind: 'block', type: 'csp_length', inputs: { LIST: shadowVar('aList') } },
        { kind: 'block', type: 'csp_append', inputs: { LIST: shadowVar('aList'), VALUE: shadowNum(0) } },
        { kind: 'block', type: 'csp_insert', inputs: { LIST: shadowVar('aList'), INDEX: shadowNum(1), VALUE: shadowNum(0) } },
        { kind: 'block', type: 'csp_remove', inputs: { LIST: shadowVar('aList'), INDEX: shadowNum(1) } },
      ],
    },
    {
      kind: 'category', name: 'Procedures', categorystyle: 'proc_category',
      contents: [
        { kind: 'block', type: 'csp_proc' },
        { kind: 'block', type: 'csp_return', inputs: { VALUE: shadowVar('result') } },
        { kind: 'block', type: 'csp_call', extraState: { n: 0 } },
        { kind: 'block', type: 'csp_call_value', extraState: { n: 0 } },
      ],
    },
    {
      kind: 'category', name: 'Input / Output', categorystyle: 'io_category',
      contents: [
        { kind: 'block', type: 'csp_display', inputs: { VALUE: shadowVar('x') } },
        { kind: 'block', type: 'csp_input' },
      ],
    },
    {
      kind: 'category', name: 'Robot', categorystyle: 'robot_category',
      contents: [
        { kind: 'block', type: 'csp_move' },
        { kind: 'block', type: 'csp_left' },
        { kind: 'block', type: 'csp_right' },
        { kind: 'block', type: 'csp_can_move' },
      ],
    },
  ],
};

const style = (c: string, s: string, t: string) => ({ colourPrimary: c, colourSecondary: s, colourTertiary: t });
export const THEME = Blockly.Theme.defineTheme('csp', {
  name: 'csp',
  base: Blockly.Themes.Classic,
  blockStyles: {
    var_blocks: style('#e07b39', '#f2b48a', '#b55d22'),
    math_blocks: style('#3f7cc4', '#9fbfe6', '#2b5a94'),
    text_blocks: style('#5a9e6f', '#a8d3b4', '#3d7550'),
    logic_blocks: style('#3c9aa3', '#9fd2d6', '#2a7179'),
    control_blocks: style('#d4a019', '#efd28a', '#a67b0c'),
    list_blocks: style('#8a5cc2', '#c6aee6', '#653e98'),
    proc_blocks: style('#c94f6d', '#e9a6b6', '#9b3550'),
    io_blocks: style('#4a4a52', '#a3a3ab', '#2c2c32'),
    robot_blocks: style('#2f8f5b', '#9ad0b1', '#1f6a41'),
  },
  categoryStyles: {
    var_category: { colour: '#e07b39' },
    math_category: { colour: '#3f7cc4' },
    logic_category: { colour: '#3c9aa3' },
    control_category: { colour: '#d4a019' },
    list_category: { colour: '#8a5cc2' },
    proc_category: { colour: '#c94f6d' },
    io_category: { colour: '#4a4a52' },
    robot_category: { colour: '#2f8f5b' },
  },
  componentStyles: {
    workspaceBackgroundColour: '#fbf9f4',
    toolboxBackgroundColour: '#f1ece1',
    toolboxForegroundColour: '#2a2722',
    flyoutBackgroundColour: '#ebe5d8',
    flyoutForegroundColour: '#2a2722',
    flyoutOpacity: 0.97,
    scrollbarColour: '#c9c0ad',
    insertionMarkerColour: '#000000',
    insertionMarkerOpacity: 0.25,
  },
  fontStyle: { family: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace', weight: '600', size: 11 },
  startHats: false,
});

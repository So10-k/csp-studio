import * as Blockly from 'blockly/core';
import * as En from 'blockly/msg/en';
import type { Program } from '../../lang/ast';
import { BlockError, jsonToProgram, programToJson, type WorkspaceJson } from './convert';
import { defineBlocks, THEME, TOOLBOX } from './defs';

Blockly.setLocale(En as unknown as Record<string, string>);
if (import.meta.env.DEV) (window as unknown as { __Blockly: unknown }).__Blockly = Blockly;

/** The drag-and-drop editor. Emits a Program whenever the blocks form a complete program. */
export class BlocksPane {
  readonly ws: Blockly.WorkspaceSvg;
  private loading = false;
  private timer = 0;
  private warned: string | null = null;
  private highlighted: string | null = null;

  constructor(
    host: HTMLElement,
    private on: { program(p: Program): void; problem(msg: string | null): void },
  ) {
    defineBlocks();
    this.ws = Blockly.inject(host, {
      toolbox: TOOLBOX,
      theme: THEME,
      renderer: 'zelos',
      trashcan: true,
      sounds: false,
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: true, wheel: false, startScale: 0.8, maxScale: 2, minScale: 0.4, scaleSpeed: 1.15, pinch: true },
      grid: { spacing: 24, length: 2, colour: '#e4ddcc', snap: false },
    });
    this.ws.addChangeListener((e) => {
      if (this.loading || e.isUiEvent) return;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.emit(), 150);
    });
  }

  /** Replace the workspace with this program (from the text editor). */
  load(p: Program) {
    this.loading = true;
    Blockly.Events.disable();
    try {
      this.ws.clear();
      Blockly.serialization.workspaces.load(programToJson(p) as object, this.ws);
      // stack the top-level groups vertically with a gap, in program order
      let y = 16;
      const tops = this.ws.getTopBlocks(false).sort((a, b) => a.getRelativeToSurfaceXY().y - b.getRelativeToSurfaceXY().y);
      for (const b of tops) {
        const xy = b.getRelativeToSurfaceXY();
        b.moveBy(16 - xy.x, y - xy.y);
        y += b.getHeightWidth().height + 32;
      }
    } finally {
      Blockly.Events.enable();
      this.loading = false;
    }
    this.ws.clearUndo();
    this.toTop();
    this.setWarning(null);
    this.highlighted = null;
  }

  private emit() {
    const json = Blockly.serialization.workspaces.save(this.ws) as WorkspaceJson;
    try {
      const p = jsonToProgram(json);
      this.setWarning(null);
      this.on.problem(null);
      this.on.program(p);
    } catch (e) {
      if (!(e instanceof BlockError)) throw e;
      this.setWarning(e.blockId ?? null, e.message);
      this.on.problem(e.message);
    }
  }

  private setWarning(id: string | null, msg?: string) {
    if (this.warned) (this.ws.getBlockById(this.warned) as Blockly.BlockSvg | null)?.setWarningText(null);
    this.warned = id;
    if (id) (this.ws.getBlockById(id) as Blockly.BlockSvg | null)?.setWarningText(msg ?? null);
  }

  /** Highlight the running statement's block (null clears). */
  highlight(id: string | null, scroll = false) {
    if (id === this.highlighted) return;
    if (this.highlighted && this.ws.getBlockById(this.highlighted)) this.ws.highlightBlock(this.highlighted, false);
    this.highlighted = id && this.ws.getBlockById(id) ? id : null;
    if (this.highlighted) {
      this.ws.highlightBlock(this.highlighted, true);
      if (scroll) {
        const b = this.ws.getBlockById(this.highlighted) as Blockly.BlockSvg;
        this.ws.scrollBoundsIntoView(b.getBoundingRectangleWithoutChildren());
      }
    }
  }

  resize() {
    Blockly.svgResize(this.ws);
  }

  /** Scroll so the top-left of the program is in view. */
  toTop() {
    const content = this.ws.getMetricsManager().getContentMetrics();
    this.ws.scroll(12 - content.left, 12 - content.top);
  }
}

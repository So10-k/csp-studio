/** Program output. Exam-faithful mode prints each DISPLAY followed by a space; "new lines" mode puts each on its own line. */
export class ConsoleView {
  private out: HTMLElement;
  private form: HTMLFormElement;
  private input: HTMLInputElement;
  private line: HTMLElement | null = null;
  private onInput: ((text: string) => void) | null = null;
  newlines = false;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div class="console-out" aria-live="polite"></div>
      <form class="console-in" hidden>
        <span class="prompt">INPUT()</span>
        <input type="text" autocomplete="off" spellcheck="false" placeholder="type a value and press Enter" />
      </form>`;
    this.out = root.querySelector('.console-out')!;
    this.form = root.querySelector('form')!;
    this.input = root.querySelector('input')!;
    this.form.onsubmit = (e) => {
      e.preventDefault();
      const text = this.input.value;
      this.input.value = '';
      this.form.hidden = true;
      this.echo(text);
      const cb = this.onInput;
      this.onInput = null;
      cb?.(text);
    };
  }

  clear() {
    this.out.innerHTML = '';
    this.line = null;
    this.form.hidden = true;
    this.onInput = null;
  }

  display(text: string) {
    if (this.newlines || !this.line) this.newLine();
    this.line!.append(document.createTextNode(text + (this.newlines ? '' : ' ')));
    this.scroll();
  }

  private newLine(cls = '') {
    this.line = document.createElement('div');
    this.line.className = `ln ${cls}`;
    this.out.append(this.line);
  }

  private echo(text: string) {
    this.newLine('echo');
    this.line!.textContent = `› ${text}`;
    this.line = null;
    this.scroll();
  }

  message(text: string, kind: 'error' | 'info' | 'ok') {
    const d = document.createElement('div');
    d.className = `ln msg ${kind}`;
    d.textContent = text;
    this.out.append(d);
    this.line = null;
    this.scroll();
  }

  ask(cb: (text: string) => void) {
    this.onInput = cb;
    this.form.hidden = false;
    this.input.focus();
    this.scroll();
  }

  private scroll() {
    this.root.scrollTop = this.root.scrollHeight;
  }
}

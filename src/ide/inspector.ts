import type { Value } from '../lang/values';
import { showInList } from '../lang/values';
import type { VM } from '../lang/vm';

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function kind(v: Value): string {
  if (Array.isArray(v)) return 'list';
  return typeof v === 'number' ? 'num' : typeof v === 'string' ? 'str' : 'bool';
}

/** Variables (lists drawn as numbered cells), call stack. Values that changed since the last update flash. */
export class Inspector {
  private prev = new Map<string, string>();

  constructor(private vars: HTMLElement, private stack: HTMLElement) {}

  clear() {
    this.prev.clear();
    this.vars.innerHTML = `<p class="empty">Variables appear here while the program runs.</p>`;
    this.stack.innerHTML = `<p class="empty">—</p>`;
  }

  update(vm: VM) {
    const next = new Map<string, string>();
    let html = '';
    for (const scope of vm.scopes()) {
      html += `<div class="scope"><div class="scope-name">${esc(scope.name)}</div>`;
      if (!scope.vars.length) html += `<p class="empty">(none yet)</p>`;
      for (const [name, v] of scope.vars) {
        const key = `${scope.name}/${name}`;
        const text = showInList(v);
        next.set(key, text);
        const changed = this.prev.has(key) ? this.prev.get(key) !== text : this.prev.size > 0;
        html += `<div class="var ${changed ? 'changed' : ''}"><span class="vname">${esc(name)}</span>`;
        if (Array.isArray(v)) {
          html += `<span class="vlist">${
            v.length
              ? v.map((x, i) => {
                  const ck = `${key}[${i}]`;
                  const ct = showInList(x);
                  next.set(ck, ct);
                  const cchanged = this.prev.size > 0 && this.prev.get(ck) !== ct;
                  return `<span class="cell ${kind(x)} ${cchanged ? 'changed' : ''}"><i>${i + 1}</i>${esc(ct)}</span>`;
                }).join('')
              : '<span class="cell nil">empty list</span>'
          }</span>`;
        } else {
          html += `<span class="vval ${kind(v)}">${esc(text)}</span>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
    this.vars.innerHTML = html;
    this.prev = next;

    this.stack.innerHTML = [...vm.frames]
      .reverse()
      .map((f, i) => `<div class="frame ${i === 0 ? 'top' : ''}"><span>${esc(f.fn.name)}</span><span class="ln">${f.stmt ? `line ${f.stmt.line}` : ''}</span></div>`)
      .join('');
  }
}

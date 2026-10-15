/** A compact version of the College Board exam reference sheet (text form), plus what this IDE adds. */
const row = (code: string, what: string) => `<tr><td><code>${code}</code></td><td>${what}</td></tr>`;
const section = (title: string, rows: string) => `<h3>${title}</h3><table>${rows}</table>`;

export const REFERENCE_HTML = [
  section('Assignment, display and input',
    row('a ← expression', 'Evaluates the expression and assigns the result to <code>a</code>. Type <code>&lt;-</code> for ←.') +
    row('DISPLAY(expression)', 'Displays the value, followed by a space.') +
    row('INPUT()', 'Accepts a value from the user and returns it.')),
  section('Arithmetic and numbers',
    row('a + b &nbsp; a - b &nbsp; a * b &nbsp; a / b', 'Usual arithmetic; <code>/</code> can give a decimal.') +
    row('a MOD b', 'The remainder when a is divided by b.') +
    row('RANDOM(a, b)', 'A random whole number from a to b, including a and b.')),
  section('Relational and Boolean',
    row('a = b &nbsp; a ≠ b &nbsp; a &gt; b &nbsp; a &lt; b &nbsp; a ≥ b &nbsp; a ≤ b', 'Compare two values. Type <code>!=</code>, <code>&gt;=</code>, <code>&lt;=</code> for ≠ ≥ ≤.') +
    row('NOT condition', 'true if the condition is false.') +
    row('c1 AND c2 &nbsp; c1 OR c2', 'Both true / at least one true.')),
  section('Selection',
    row('IF (condition)<br>{ &lt;block&gt; }', 'Runs the block if the condition is true.') +
    row('IF (condition)<br>{ &lt;first block&gt; }<br>ELSE<br>{ &lt;second block&gt; }', 'Runs one block or the other.')),
  section('Iteration',
    row('REPEAT n TIMES<br>{ &lt;block&gt; }', 'Runs the block n times.') +
    row('REPEAT UNTIL (condition)<br>{ &lt;block&gt; }', 'Runs the block until the condition is true (checked before each time).')),
  section('Lists (the first element has index 1)',
    row('aList ← [value1, value2, value3]', 'Creates a list. <code>[]</code> is an empty list.') +
    row('aList ← bList', 'Assigns a <em>copy</em> of bList to aList.') +
    row('aList[i]', 'The element at index i. An index below 1 or above the length is an error and the program terminates.') +
    row('aList[i] ← x', 'Assigns x to the element at index i.') +
    row('INSERT(aList, i, value)', 'Shifts elements at i and after one place right, then puts value at i.') +
    row('APPEND(aList, value)', 'Adds value to the end; the length grows by 1.') +
    row('REMOVE(aList, i)', 'Removes the element at i; later elements shift left.') +
    row('LENGTH(aList)', 'The number of elements.') +
    row('FOR EACH item IN aList<br>{ &lt;block&gt; }', 'Assigns each element to item in turn, running the block each time.')),
  section('Procedures',
    row('PROCEDURE name(p1, p2)<br>{ &lt;instructions&gt; }', 'Defines a procedure. Call it with <code>name(arg1, arg2)</code>.') +
    row('RETURN(expression)', 'Ends the procedure and gives back the value.')),
  section('Robot',
    row('MOVE_FORWARD()', 'Moves one square forward. Moving into a wall or off the grid terminates the program.') +
    row('ROTATE_LEFT() &nbsp; ROTATE_RIGHT()', 'Turns 90° in place.') +
    row('CAN_MOVE(direction)', 'true if the square in that direction (left, right, forward, backward) is open.')),
  `<h3>In this IDE</h3><ul>
    <li>Click a line number to set a <b>breakpoint</b>. <b>Step</b> runs one statement (F11), <b>Step over</b> skips through procedure calls (F10), <b>Step out</b> finishes the current procedure (Shift+F11). Ctrl/⌘+Enter runs or pauses.</li>
    <li><b>Values in code</b> (the switch above the editor) shows what each line last set, how many times it ran (×n), and whether an IF or REPEAT UNTIL condition was true.</li>
    <li>The <b>Trace</b> tab builds a trace table: one row per statement that ran, one column per variable. Turn on <b>Practice</b> to hide the values and fill them in yourself, then press <b>Check</b>. <b>Copy</b> pastes the table into a spreadsheet.</li>
    <li>The <b>Runs</b> tab runs the whole program with different INPUT values and checks the output against what you expect. <b>How often?</b> runs it many times and counts each output (great for RANDOM).</li>
    <li>Extras that aren't on the exam: <code>// comments</code>, and <code>+</code> joins text (<code>"n = " + n</code>).</li>
    <li>Variables made inside a procedure are local to it; a procedure can change a global that already exists. Lists passed to a procedure are shared, not copied.</li>
    <li>Editing in the Blocks view rewrites the text in standard form, so comments are dropped.</li>
  </ul>`,
].join('');

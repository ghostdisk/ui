// Demo: builds a box tree once, then mutates it from keyboard and pointer input.
// Nothing renders unless something calls set()/add()/remove() or the canvas resizes.

export {};

let lastClick = '-';
let lastChange = '-';
// Labels are non-interactive, so the target is the button itself; read its label child.
const labelOf = (b: UIBox) => b.children.find(c => c instanceof UIText)?.text ?? '?';
const logClick = (e: BoxEvent) => (lastClick = labelOf(e.target));

const box = (props: BoxProps = {}) => new UIBox(props);
const label = (text: string, props: TextProps = {}) => new UIText({ text, ...props });
const swatch = (w: number, h: number, color: string) => box({ width: w, height: h, color });

const ALIGN_NAMES = ['Start', 'Center', 'End', 'Stretch'];
const COLORS = ['#e06c75', '#98c379', '#61afef', '#e5c07b', '#c678dd', '#56b6c2'];

// --- header: logo, spacer (flex 1), buttons; cross-centered
const header = box({
  height: 48, padding: 8, gap: 8, crossAlign: Alignment.Center, color: '#2c313a',
  children: [
    box({ width: 32, height: 32, radius: 8, color: '#61afef' }),
    label('Tiny UI'),
    box({ flex: 1 }),
    ...['File', 'Edit', 'Help'].map(text => button({ text, onClick: logClick })),
  ],
});

// --- sidebar: vertical scroll box, fixed width, items stretched across
const folders = ['Inbox', 'Drafts', 'Sent', 'Archive', 'Spam', 'Trash', ...Array.from({ length: 1000 }, (_, i) => `Folder ${i + 1}`)];
const sidebar = scrollBox({
  width: 180, padding: 8, color: '#252830',
  content: { gap: 6 },
  children: folders.map(t =>
    box({ height: 28, padding: [0, 8], radius: 4, crossAlign: Alignment.Center, color: '#3e4451', children: [label(t, { color: '#abb2bf' })] })),
});

// --- flex ratios 1:2:3
const flexRow = box({
  height: 40, gap: 4, crossAlign: Alignment.Stretch,
  children: [1, 2, 3].map((f, i) => box({ flex: f, color: COLORS[i] })),
});

// --- grid of flex rows: columns vary mainAlign, rows vary crossAlign
const ALIGNMENTS = [Alignment.Start, Alignment.Center, Alignment.End, Alignment.Stretch];
const threeSwatches = () => [swatch(24, 24, COLORS[0]), swatch(40, 16, COLORS[1]), swatch(16, 40, COLORS[2])];
const centered = (child: UIBox) => box({ mainAlign: Alignment.Center, crossAlign: Alignment.Center, children: [child] });
const alignGrid = box({
  layout: UI.layouts.grid, columns: 5, gap: 4,
  children: [
    centered(label('cross \\ main', { color: '#7f848e' })),
    ...ALIGNMENTS.map(a => centered(label(ALIGN_NAMES[a], { color: '#abb2bf' }))),
    ...ALIGNMENTS.flatMap(cross => [
      centered(label(ALIGN_NAMES[cross], { color: '#abb2bf' })),
      ...ALIGNMENTS.map(main => box({
        height: 64, padding: 4, gap: 4, mainAlign: main, crossAlign: cross, radius: 6, color: '#2c313a',
        children: threeSwatches(),
      })),
    ]),
  ],
});

// --- min size bubbling up: no sizes set on the containers, only on leaves
const nested = box({
  padding: 6, gap: 6, radius: 8, color: '#3e4451',
  children: [
    box({
      direction: Direction.Column, padding: 6, gap: 6, radius: 4, color: '#4b5263',
      children: [swatch(60, 20, COLORS[3]), swatch(30, 20, COLORS[4])],
    }),
    box({
      padding: 6, gap: 6, radius: 4, border: 2, borderColor: '#e5c07b', crossAlign: Alignment.End,
      children: [swatch(20, 50, COLORS[5]), swatch(20, 30, COLORS[0]), swatch(20, 10, COLORS[1])],
    }),
  ],
});

// --- virtual list: 100k rows, only the visible ones exist; click a row to select it
let selectedRow = -1;
const rowIndex = new WeakMap<UIBox, number>();
const bigList: UIVirtualList = virtualList({
  flex: 1, height: 220, radius: 8, color: '#252830',
  count: 100_000,
  rowHeight: 28,
  createRow: () => {
    const row = box({
      padding: [0, 10], gap: 8, crossAlign: Alignment.Center, cursor: 'pointer',
      children: [box({ width: 10, height: 10, radius: 5 }), label(''), box({ flex: 1 }), label('', { color: '#7f848e' })],
    });
    row.on('pointerenter', () => bigList.refresh()).on('pointerleave', () => bigList.refresh());
    row.on('click', () => {
      selectedRow = rowIndex.get(row) ?? -1;
      bigList.refresh();
    });
    return row;
  },
  bindRow: (row, i) => {
    rowIndex.set(row, i);
    const [dot, name, , size] = row.children as [UIBox, UIText, UIBox, UIText];
    row.set({ color: i === selectedRow ? '#3b82f6' : row.hovered ? '#3e4451' : i % 2 ? '#2a2e36' : null });
    dot.set({ color: COLORS[i % COLORS.length] });
    name.set({ text: `Row ${i + 1}` });
    size.set({ text: `${(i * 7919) % 1000} KB`, color: i === selectedRow ? '#dbe6ff' : '#7f848e' });
  },
});

// --- buttons: sized by their label, one forced tall, one grown by flex.
// OK / Cancel add and remove playground swatches (defined below; only used on click).
const buttonRow = box({
  gap: 8, crossAlign: Alignment.End,
  children: [
    button({ text: 'OK', onClick: () => { playground.add(swatch(24 + Math.random() * 40, 24 + Math.random() * 40, COLORS[playground.children.length % COLORS.length])); styleSwatches(); } }),
    button({ text: 'Cancel', onClick: () => { const k = playground.children.at(-1); if (k) playground.remove(k); } }),
    button({ text: 'A much longer label' }),
    button({ text: 'Tall', height: 72 }),
    button({ text: 'Flex', flex: 1 }),
  ],
});
// Clicks bubble: one listener on the row sees every button in it.
buttonRow.on('click', logClick);

// --- checkboxes: each raises a bubbling 'change'; read the value off the widget
const roundedBox = checkbox({ text: 'Rounded swatches', checked: true, onChange: () => styleSwatches() });
const bordersBox = checkbox({ text: 'Borders', onChange: () => styleSwatches() });
const flexBox = checkbox({ text: 'Purple flex', onChange: () => growMe.set({ flex: flexBox.checked ? 1 : 0 }) });
const checkboxRow = box({ gap: 16, children: [roundedBox, bordersBox, flexBox] });
checkboxRow.on('change', e => {
  const cb = e.target as UICheckbox;
  lastChange = `${cb.label.text} = ${cb.checked}`;
});

function styleSwatches() {
  for (const c of playground.children) {
    c.set({ radius: roundedBox.checked ? 10 : 0, border: bordersBox.checked ? 3 : 0, borderColor: '#ffffffb0' });
  }
}

// --- keyboard-driven playground
const growMe = swatch(48, 48, COLORS[4]);
const playground = box({
  flex: 1, padding: 12, gap: 12, radius: 8, border: 1, borderColor: '#3e4451', color: '#2c313a',
  children: [swatch(48, 32, COLORS[0]), swatch(80, 64, COLORS[1]), growMe, swatch(32, 96, COLORS[2])],
});

// Horizontal-only: OK keeps adding swatches until it scrolls sideways.
const playgroundScroll = scrollBox({ flex: 1, scrollX: true, scrollY: false, children: [playground] });

// --- main column: scrolls both ways when the window is too small; the scroll boxes nest
const main = scrollBox({
  flex: 1, scrollX: true,
  content: { padding: 8, gap: 8 },
  children: [flexRow, alignGrid, box({ gap: 8, children: [nested, bigList] }), buttonRow, checkboxRow, playgroundScroll],
});
styleSwatches();

const root = box({
  direction: Direction.Column, crossAlign: Alignment.Stretch, color: '#1e2127',
  children: [
    header,
    box({ flex: 1, padding: [8, 0, 0, 8], gap: 8, crossAlign: Alignment.Stretch, children: [sidebar, main] }),
    box({
      height: 24, padding: [0, 8], crossAlign: Alignment.Center, color: '#2c313a',
      children: [label('The quick brown fox jumps over the lazy dog. 0123456789 !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', { color: '#7f848e' })],
    }),
  ],
});

const canvas = document.getElementById('ui') as HTMLCanvasElement;
const surface = new UI.Surface(canvas, root);

const hud = document.getElementById('hud')!;
surface.onRender = s => {
  hud.textContent =
    `renders: ${s.renderCount}  draw calls: ${s.drawCalls}  boxes painted: ${s.paintedCount}/${s.boxCount}  list rows: ${bigList.first + 1}+  selected: ${selectedRow + 1}\n` +
    `last click: ${lastClick}  last change: ${lastChange}\n` +
    `playground  dir: ${playground.direction === Direction.Row ? 'Row' : 'Column'}` +
    `  main: ${ALIGN_NAMES[playground.mainAlign]}` +
    `  cross: ${ALIGN_NAMES[playground.crossAlign]}` +
    `  purple flex: ${growMe.flex}\n` +
    `[1-4] main align  [Q W E R] cross align  [D] direction  [F] toggle purple flex`;
};

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  const mainIdx = '1234'.indexOf(k);
  const crossIdx = 'qwer'.indexOf(k);
  if (mainIdx >= 0) playground.set({ mainAlign: mainIdx });
  else if (crossIdx >= 0) playground.set({ crossAlign: crossIdx });
  else if (k === 'd') playground.set({ direction: playground.direction === Direction.Row ? Direction.Column : Direction.Row });
  else if (k === 'f') {
    // Setting the value from code updates the checkbox but raises no change event.
    flexBox.checked = !flexBox.checked;
    growMe.set({ flex: flexBox.checked ? 1 : 0 });
  }
});

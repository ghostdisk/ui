// Demo: builds a box tree once, then mutates it from keyboard and pointer input.
// Nothing renders unless something calls set()/add()/remove() or the canvas resizes.

export {};

let lastClick = '-';
// Labels are non-interactive, so the target is the button itself; read its label child.
const labelOf = (b: UIBox) => b.children.find(c => c instanceof UIText)?.text ?? '?';
const logClick = (e: BoxEvent) => (lastClick = labelOf(e.target));

const box = (props: BoxProps = {}) => new UIBox(props);
const square = (size: number, color: string) => box({ width: size, height: size, color });
const label = (text: string, props: TextProps = {}) => new UIText({ text, ...props });
const swatch = (w: number, h: number, color: string) => box({ width: w, height: h, color });

const ALIGN_NAMES = ['Start', 'Center', 'End', 'Stretch'];
const COLORS = ['#e06c75', '#98c379', '#61afef', '#e5c07b', '#c678dd', '#56b6c2'];

// --- header: logo, spacer (flex 1), buttons; cross-centered
const header = box({
  height: 48, padding: 8, gap: 8, crossAlign: Alignment.Center, color: '#2c313a',
  children: [
    square(32, '#61afef'),
    label('Tiny UI'),
    box({ flex: 1 }),
    ...['File', 'Edit', 'Help'].map(text => button({ text, onClick: logClick })),
  ],
});

// --- sidebar: fixed width, items stretched across
const sidebar = box({
  direction: Direction.Column, width: 180, padding: 8, gap: 6,
  crossAlign: Alignment.Stretch, color: '#252830',
  children: ['Inbox', 'Drafts', 'Sent', 'Archive', 'Spam', 'Trash'].map(t =>
    box({ height: 28, padding: [0, 8], crossAlign: Alignment.Center, color: '#3e4451', children: [label(t, { color: '#abb2bf' })] })),
});

// --- flex ratios 1:2:3
const flexRow = box({
  height: 40, gap: 4, crossAlign: Alignment.Stretch,
  children: [1, 2, 3].map((f, i) => box({ flex: f, color: COLORS[i] })),
});

// --- the four main-axis alignments side by side
const threeSwatches = () => [swatch(24, 24, COLORS[0]), swatch(40, 16, COLORS[1]), swatch(16, 40, COLORS[2])];
const alignRow = box({
  gap: 8, crossAlign: Alignment.Stretch,
  children: [Alignment.Start, Alignment.Center, Alignment.End, Alignment.Stretch].map(a =>
    box({
      flex: 1, height: 56, padding: 4, gap: 4,
      mainAlign: a, crossAlign: Alignment.Center, color: '#2c313a',
      children: threeSwatches(),
    })),
});

// --- min size bubbling up: no sizes set on the containers, only on leaves
const nested = box({
  padding: 6, gap: 6, color: '#3e4451',
  children: [
    box({
      direction: Direction.Column, padding: 6, gap: 6, color: '#4b5263',
      children: [swatch(60, 20, COLORS[3]), swatch(30, 20, COLORS[4])],
    }),
    box({
      padding: 6, gap: 6, color: '#4b5263', crossAlign: Alignment.End,
      children: [swatch(20, 50, COLORS[5]), swatch(20, 30, COLORS[0]), swatch(20, 10, COLORS[1])],
    }),
  ],
});

// --- buttons: sized by their label, one forced tall, one grown by flex.
// OK / Cancel add and remove playground swatches (defined below; only used on click).
const buttonRow = box({
  gap: 8, crossAlign: Alignment.End,
  children: [
    button({ text: 'OK', onClick: () => playground.add(swatch(24 + Math.random() * 40, 24 + Math.random() * 40, COLORS[playground.children.length % COLORS.length])) }),
    button({ text: 'Cancel', onClick: () => { const k = playground.children.at(-1); if (k) playground.remove(k); } }),
    button({ text: 'A much longer label' }),
    button({ text: 'Tall', height: 72 }),
    button({ text: 'Flex', flex: 1 }),
  ],
});
// Clicks bubble: one listener on the row sees every button in it.
buttonRow.on('click', logClick);

// --- keyboard-driven playground
const growMe = swatch(48, 48, COLORS[4]);
const playground = box({
  flex: 1, padding: 12, gap: 12, color: '#2c313a',
  children: [swatch(48, 32, COLORS[0]), swatch(80, 64, COLORS[1]), growMe, swatch(32, 96, COLORS[2])],
});

const main = box({
  flex: 1, direction: Direction.Column, padding: 8, gap: 8, crossAlign: Alignment.Stretch,
  children: [flexRow, alignRow, box({ children: [nested] }), buttonRow, playground],
});

const root = box({
  direction: Direction.Column, crossAlign: Alignment.Stretch, color: '#1e2127',
  children: [
    header,
    box({ flex: 1, padding: 8, gap: 8, crossAlign: Alignment.Stretch, children: [sidebar, main] }),
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
    `renders: ${s.renderCount}  last click: ${lastClick}\n` +
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
  else if (k === 'f') growMe.set({ flex: growMe.flex ? 0 : 1 });
});

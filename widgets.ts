// Widgets: plain UIBoxes preconfigured with atlas skins. Global script, like ui.ts.

interface ButtonProps extends BoxProps {
  text: string;
}

// Extra bottom padding keeps content centred on the face, above the lip. When pressed the
// face sinks 3px, so the content moves with it (same total, so the min size doesn't change).
const BUTTON_PADDING: Padding = [8, 16, 12, 16];
const BUTTON_PADDING_DOWN: Padding = [11, 16, 9, 16];

function button({ text, ...props }: ButtonProps) {
  const b = new UIBox({
    bg: UI.atlas.button,
    padding: BUTTON_PADDING,
    mainAlign: Alignment.Center,
    crossAlign: Alignment.Center,
    cursor: 'pointer',
    children: [new UIText({ text, shadow: '#0e2a5c' })],
    ...props,
  });
  // Stays down from pointerdown until pointerup, even if the pointer leaves the button.
  const refresh = () => {
    b.set({
      bg: b.pressed ? UI.atlas.buttonDown : b.hovered ? UI.atlas.buttonHover : UI.atlas.button,
      padding: b.pressed ? BUTTON_PADDING_DOWN : BUTTON_PADDING,
    });
  };
  b.on('pointerenter', refresh).on('pointerleave', refresh).on('pointerdown', refresh).on('pointerup', refresh);
  return b;
}

interface CheckboxProps extends BoxProps {
  text?: string;
  checked?: boolean;
  onChange?: BoxEventHandler;
}

/**
 * Rounded box + tick + label. Clicking anywhere on it toggles `checked` and raises a
 * bubbling 'change' event. Setting `checked` from code updates the look but raises nothing.
 */
class UICheckbox extends UIBox {
  readonly tick = new UIBox({ width: 16, height: 16, interactive: false });
  readonly indicator = new UIBox({
    width: 20, height: 20, radius: 5, border: 2, interactive: false,
    mainAlign: Alignment.Center, crossAlign: Alignment.Center,
    children: [this.tick],
  });
  readonly label = new UIText({ color: '#abb2bf' });
  private value = false;

  constructor({ text = '', checked = false, onChange, ...props }: CheckboxProps = {}) {
    // Field initializers run after super(), so build everything once they're in place.
    super();
    this.label.set({ text });
    this.value = checked;
    this.set({
      gap: 8, crossAlign: Alignment.Center, cursor: 'pointer',
      children: [this.indicator, this.label],
      ...props,
    });
    if (onChange) this.on('change', onChange);
    const refresh = () => this.refresh();
    this.on('pointerenter', refresh).on('pointerleave', refresh).on('pointerdown', refresh).on('pointerup', refresh);
    this.on('click', e => {
      this.checked = !this.checked;
      this.dispatch('change', e.x, e.y);
    });
    this.refresh();
  }

  get checked() {
    return this.value;
  }

  set checked(v: boolean) {
    if (v === this.value) return;
    this.value = v;
    this.refresh();
  }

  private refresh() {
    const fill = this.value
      ? (this.pressed ? '#2f6fd6' : this.hovered ? '#4d8ff8' : '#3b82f6')
      : (this.pressed ? '#2c313a' : '#1e2127');
    const border = this.value ? fill : this.hovered ? '#61afef' : '#5c6370';
    this.indicator.set({ color: fill, borderColor: border });
    this.tick.set({ bg: this.value ? UI.atlas.check : null });
  }
}

const checkbox = (props: CheckboxProps = {}) => new UICheckbox(props);

// ---------------------------------------------------------------------------
// Scroll box. All scrolling lives here: UIScroll wraps an inner `content` box, sizes and
// offsets it with its own layout, clips it via childClip(), and draws and drives its own
// scrollbars. The core only knows about clipping, paintOver() and wheel events.

interface ScrollProps extends BoxProps {
  scrollX?: boolean;
  scrollY?: boolean;
  /** Props for the inner content box (default: column with stretched children). */
  content?: BoxProps;
}

const SCROLLBAR_SIZE = 10;
const SCROLLBAR_MIN_THUMB = 24;

type Axis = 'x' | 'y';

/**
 * Measure: along a scrolled axis the content can be any size, so it doesn't push up the
 * scroll box's min size. Arrange: the content gets at least the viewport's size (more if it
 * needs it) and is shifted by the scroll offset.
 */
const scrollLayout: ILayout = {
  measure(box) {
    const s = box as UIScroll;
    const c = s.content;
    c.layout.measure(c);
    UI.setMinSize(s, (s.scrollX ? 0 : c.minW) + s.gutterW, (s.scrollY ? 0 : c.minH) + s.gutterH);
  },

  arrange(box) {
    const s = box as UIScroll;
    const c = s.content;
    const v = s.viewport();
    c.w = s.scrollX ? Math.max(v.w, c.minW) : v.w;
    c.h = s.scrollY ? Math.max(v.h, c.minH) : v.h;
    // Content may have shrunk since the offset was set.
    s.offsetX = Math.min(s.offsetX, s.maxScroll('x'));
    s.offsetY = Math.min(s.offsetY, s.maxScroll('y'));
    c.x = v.x - s.offsetX;
    c.y = v.y - s.offsetY;
    c.layout.arrange(c);
  },
};

class UIScroll extends UIBox {
  layout: ILayout = scrollLayout;
  scrollX = false;
  scrollY = true;
  /** Current scroll position in CSS px; change it with scrollTo/scrollBy. */
  offsetX = 0;
  offsetY = 0;
  /** Holds the scrolled children; add() and remove() go here. */
  readonly content = new UIBox({ direction: Direction.Column, crossAlign: Alignment.Stretch });
  private drag: { axis: Axis; grab: number } | null = null;
  private hoverBar: Axis | null = null;

  constructor(props: ScrollProps = {}) {
    // Field initializers run after super(), so wire up the content once it exists.
    super();
    this.content.parent = this;
    this.children = [this.content];
    this.set(props);

    this.on('wheel', e => {
      let dx = this.scrollX ? e.dx : 0;
      const dy = this.scrollY ? e.dy : 0;
      // A plain wheel scrolls a horizontal-only box sideways.
      if (this.scrollX && !this.scrollY && dx === 0) dx = e.dy;
      // Consume the wheel only if we actually moved, so outer scroll boxes take over at the ends.
      if (this.scrollBy(dx, dy)) e.stopPropagation();
    });
    this.on('pointerdown', e => {
      const axis = this.barAt(e.x, e.y);
      const bar = axis && this.bar(axis);
      if (!axis || !bar) return;
      const p = axis === 'x' ? e.x : e.y;
      if (p < bar.thumbStart || p >= bar.thumbStart + bar.thumbLen) {
        // Clicked the track: jump so the thumb is centred under the pointer, then drag it.
        this.setOffset(axis, ((p - bar.trackStart - bar.thumbLen / 2) / bar.travel) * bar.max);
        this.drag = { axis, grab: bar.thumbLen / 2 };
      } else {
        this.drag = { axis, grab: p - bar.thumbStart };
      }
      this.invalidate();
      e.stopPropagation();
    });
    this.on('pointermove', e => {
      if (this.drag) {
        const { axis, grab } = this.drag;
        const bar = this.bar(axis);
        if (bar) this.setOffset(axis, ((axis === 'x' ? e.x : e.y) - grab - bar.trackStart) / bar.travel * bar.max);
      } else {
        this.setHoverBar(this.barAt(e.x, e.y));
      }
    });
    this.on('pointerup', () => {
      if (!this.drag) return;
      this.drag = null;
      this.invalidate();
    });
    this.on('pointerleave', () => this.setHoverBar(null));
  }

  set(props: ScrollProps): this {
    const { children, content, ...rest } = props;
    super.set(rest);
    if (content || children) this.content.set({ ...content, ...(children && { children }) });
    return this;
  }

  add(...kids: UIBox[]): this {
    this.content.add(...kids);
    return this;
  }

  remove(kid: UIBox): this {
    this.content.remove(kid);
    return this;
  }

  /** Width taken by the vertical scrollbar. */
  get gutterW() {
    return this.scrollY ? SCROLLBAR_SIZE : 0;
  }

  /** Height taken by the horizontal scrollbar. */
  get gutterH() {
    return this.scrollX ? SCROLLBAR_SIZE : 0;
  }

  /** Where the content is laid out: inside the padding, minus the scrollbar gutters. */
  viewport(): Rect {
    const p = UI.paddingOf(this);
    return {
      x: this.x + p.l,
      y: this.y + p.t,
      w: Math.max(0, this.w - p.l - p.r - this.gutterW),
      h: Math.max(0, this.h - p.t - p.b - this.gutterH),
    };
  }

  /** Content shows through the padding but not over the scrollbars. */
  childClip(): Rect {
    return { x: this.x, y: this.y, w: Math.max(0, this.w - this.gutterW), h: Math.max(0, this.h - this.gutterH) };
  }

  maxScroll(axis: Axis) {
    const v = this.viewport();
    return Math.max(0, axis === 'x' ? this.content.w - v.w : this.content.h - v.h);
  }

  scrollTo(x: number, y: number) {
    const movedX = this.setOffset('x', x);
    const movedY = this.setOffset('y', y);
    return movedX || movedY;
  }

  scrollBy(dx: number, dy: number) {
    return this.scrollTo(this.offsetX + dx, this.offsetY + dy);
  }

  /** Clamps and rounds (whole pixels keep text sharp); returns whether it changed. */
  private setOffset(axis: Axis, v: number) {
    v = Math.round(Math.max(0, Math.min(v, this.maxScroll(axis))));
    if (v === (axis === 'x' ? this.offsetX : this.offsetY)) return false;
    if (axis === 'x') this.offsetX = v;
    else this.offsetY = v;
    this.invalidate();
    return true;
  }

  /** Scrollbar geometry along one axis, or null if that axis has nothing to scroll. */
  private bar(axis: Axis) {
    const enabled = axis === 'x' ? this.scrollX : this.scrollY;
    const max = this.maxScroll(axis);
    if (!enabled || max <= 0) return null;
    const track: Rect = axis === 'y'
      ? { x: this.x + this.w - SCROLLBAR_SIZE, y: this.y, w: SCROLLBAR_SIZE, h: this.h - this.gutterH }
      : { x: this.x, y: this.y + this.h - SCROLLBAR_SIZE, w: this.w - this.gutterW, h: SCROLLBAR_SIZE };
    const trackStart = axis === 'y' ? track.y : track.x;
    const trackLen = axis === 'y' ? track.h : track.w;
    const viewLen = axis === 'y' ? this.viewport().h : this.viewport().w;
    const thumbLen = Math.min(trackLen, Math.max(SCROLLBAR_MIN_THUMB, trackLen * viewLen / (viewLen + max)));
    const travel = Math.max(1, trackLen - thumbLen);
    const offset = axis === 'y' ? this.offsetY : this.offsetX;
    return { track, trackStart, thumbStart: trackStart + travel * offset / max, thumbLen, travel, max };
  }

  private barAt(x: number, y: number): Axis | null {
    for (const axis of ['y', 'x'] as const) {
      const t = this.bar(axis)?.track;
      if (t && x >= t.x && y >= t.y && x < t.x + t.w && y < t.y + t.h) return axis;
    }
    return null;
  }

  private setHoverBar(axis: Axis | null) {
    if (axis === this.hoverBar) return;
    this.hoverBar = axis;
    this.invalidate();
  }

  paintOver(s: Surface) {
    for (const axis of ['y', 'x'] as const) {
      const bar = this.bar(axis);
      if (!bar) continue;
      const active = this.drag?.axis === axis || this.hoverBar === axis;
      const color = UI.parseColor(active ? '#9da5b4' : '#5c6370');
      // 2px inset inside the gutter, rounded into a pill.
      const [x, y, w, h] = axis === 'y'
        ? [bar.track.x + 2, bar.thumbStart + 2, bar.track.w - 4, bar.thumbLen - 4]
        : [bar.thumbStart + 2, bar.track.y + 2, bar.thumbLen - 4, bar.track.h - 4];
      s.rect(x, y, w, h, color, 3, 0, UI.TRANSPARENT);
    }
  }
}

// Not `scroll`: that's already window.scroll().
const scrollBox = (props: ScrollProps = {}) => new UIScroll(props);

// ---------------------------------------------------------------------------
// Virtual list: a vertical UIScroll whose content only holds the rows in view. Rows have a
// fixed height and are recycled: createRow() builds one, bindRow() fills it for an index.
// The content box is sized to the full list, and a spacer at the top pushes the visible
// rows down to where they belong.

interface VirtualListProps extends Omit<ScrollProps, 'children'> {
  count?: number;
  rowHeight?: number;
  createRow?: () => UIBox;
  bindRow?: (row: UIBox, index: number) => void;
}

/** Rebuilds the visible rows right before the normal scroll layout places them. */
const virtualListLayout: ILayout = {
  measure(box) {
    scrollLayout.measure(box);
  },
  arrange(box) {
    const list = box as UIVirtualList;
    list.syncRows();
    // The rows may have changed, so measure the content again before it's placed.
    list.content.layout.measure(list.content);
    scrollLayout.arrange(box);
  },
};

class UIVirtualList extends UIScroll {
  layout: ILayout = virtualListLayout;
  count = 0;
  rowHeight = 28;
  createRow: () => UIBox = () => new UIBox();
  bindRow: (row: UIBox, index: number) => void = () => {};
  /** Index of the first row currently in `content` (after the spacer). */
  first = 0;
  private spacer = new UIBox({ interactive: false });
  /** Rows built so far; the first `shown` are in use. Grows to the most rows ever visible. */
  private pool: UIBox[] = [];

  constructor(props: VirtualListProps = {}) {
    super();
    this.set({ scrollX: false, scrollY: true, ...props });
  }

  set(props: VirtualListProps): this {
    return super.set(props);
  }

  /** Re-binds the visible rows on the next render, e.g. after the data behind them changed. */
  refresh() {
    this.invalidate();
  }

  /** Called during layout, when this box's size is final. Invalidations here don't re-render. */
  syncRows() {
    const v = this.viewport();
    const total = this.count * this.rowHeight;
    const offset = Math.max(0, Math.min(this.offsetY, total - v.h));
    this.first = Math.floor(offset / this.rowHeight);
    const end = Math.min(this.count, Math.ceil((offset + v.h) / this.rowHeight));
    const shown = Math.max(0, end - this.first);

    while (this.pool.length < shown) this.pool.push(this.createRow());
    const rows = this.pool.slice(0, shown);
    rows.forEach((row, i) => {
      row.set({ height: this.rowHeight });
      this.bindRow(row, this.first + i);
    });
    this.spacer.set({ height: this.first * this.rowHeight });
    this.content.set({ height: total, children: [this.spacer, ...rows] });
  }
}

const virtualList = (props: VirtualListProps = {}) => new UIVirtualList(props);

Object.assign(window, { button, checkbox, scrollBox, virtualList, UICheckbox, UIScroll, UIVirtualList });

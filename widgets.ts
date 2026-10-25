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

Object.assign(window, { button, checkbox, UICheckbox });

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
    text,
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

Object.assign(window, { button });

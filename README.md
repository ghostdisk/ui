# Tiny UI

A small retained-mode UI library on WebGL2, written as a demo of a two-pass layout algorithm.
Live demo: https://ghostdisk.github.io/ui/

```
npm i && npm run dev
```

## How it's built

Everything is a tree of `UIBox`es. A box has style props (`direction`, `mainAlign`,
`crossAlign`, `flex`, `padding`, `color`, `radius`, …) and a `layout` object with two passes:

1. **measure** (bottom-up): compute the box's minimum size from its children.
2. **arrange** (top-down): the box's size is now final; place and size the children, then recurse.

Flex hands out leftover space by `flex` weights or main-axis alignment; cross-axis alignment
can stretch children. Grid sizes each track to its largest child and splits what's left.
Text and scroll boxes are just other layouts. Widgets like `UIScroll` keep their
complexity to themselves; the core only knows about clip rects, `paintOver`, and events.

Input: DOM pointer and wheel events are hit-tested down the tree and bubbled back up as
our own events (`click`, `change`, `wheel`, …), with pointer capture while a button is held.

## How it's rendered

- **On demand only.** No animation loop. `set()` / `add()` / `remove()` invalidate, and all
  changes in one task are merged into a single render on the next microtask.
- **One shader, one texture.** Every quad samples the atlas and is tinted by its colour.
  Solid boxes sample a white texel; nine-slices and glyphs sample their atlas regions. Rounded
  corners and borders are a signed-distance function in the same shader, so they cost nothing extra.
- **One buffer upload per frame.** All quads go into one vertex array. A new draw call only
  starts when the clip rect changes (scroll boxes use the scissor test), so the whole demo
  is about 7 draw calls.
- **Culling.** After layout each box gets its subtree's extent; subtrees outside the current
  clip aren't drawn at all (e.g. 241 of 2,200 boxes on the demo's first frame).
- **Virtual lists** create only the visible rows and recycle them, so a 100,000-row list costs
  the same as a 10-row one.

## Why it's simple and fast

- One node type, two layout passes, one shader. There's no CSS cascade, no DOM, no diffing:
  you mutate boxes and the next frame redoes layout and painting from scratch.
- Redoing everything is cheap because the work is tiny: layout is plain arithmetic over a
  few thousand boxes, and drawing is one upload plus a handful of draw calls.
  A wheel scroll in the demo takes about 5 ms end to end.
- Nothing renders unless something changed, so an idle UI uses no CPU or GPU.

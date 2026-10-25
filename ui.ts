// Tiny retained-mode UI on WebGL. Renders only on demand (no RAF loop).
//
// This file is deliberately a global script (no import/export) so its declarations
// are visible to the other files for type checking; at runtime we put them on `window`.

enum Alignment { Start, Center, End, Stretch }
enum Direction { Row, Column }

interface ILayout {
  /** Pass 1, bottom-up: compute box.minW / box.minH (recursing into children as needed). */
  measure(box: UIBox): void;
  /** Pass 2, top-down: box.x/y/w/h are final; size and place the children, then recurse. */
  arrange(box: UIBox): void;
}

/** CSS-style: all sides, [vertical, horizontal], or [top, right, bottom, left]. */
type Padding = number | [number, number] | [number, number, number, number];

interface BoxProps {
  layout?: ILayout;
  direction?: Direction;
  mainAlign?: Alignment;
  crossAlign?: Alignment;
  /** Overrides the parent's crossAlign for this box. */
  alignSelf?: Alignment | null;
  /** Share of the parent's free main-axis space. 0 = don't grow. */
  flex?: number;
  gap?: number;
  padding?: Padding;
  /** Fixed minimum size; content can still make the box larger. */
  width?: number | null;
  height?: number | null;
  /** Background image from the atlas. */
  bg?: NineSlice | null;
  /** Solid fill if there is no bg, tint of the bg otherwise. */
  color?: string | null;
  /** Not drawn yet; only contributes to the box's min size. */
  text?: string | null;
  /** CSS cursor shown while hovering; the deepest box that sets one wins. */
  cursor?: string | null;
  onClick?: BoxEventHandler | null;
  children?: UIBox[];
}

// ---------------------------------------------------------------------------
// Events
//
// The Surface turns DOM pointer events into BoxEvents. It hit-tests down the tree to get
// the path root..target, then dispatches:
//   pointerenter/leave  to each box the pointer entered/left (no bubbling)
//   pointermove/down/up from the target up to the root (bubbling, stoppable)
//   click               on up, from the deepest box that got both the down and the up
// While the primary button is held, move/up go to the box that got the down (capture).

type BoxEventType = 'pointerenter' | 'pointerleave' | 'pointermove' | 'pointerdown' | 'pointerup' | 'click';
type BoxEventHandler = (e: BoxEvent) => void;

class BoxEvent {
  /** The box currently handling the event (changes while bubbling). */
  current: UIBox;
  stopped = false;

  constructor(
    public type: BoxEventType,
    /** Pointer position in CSS pixels, relative to the canvas. */
    public x: number,
    public y: number,
    /** The deepest box the event was dispatched to. */
    public target: UIBox,
  ) {
    this.current = target;
  }

  stopPropagation() {
    this.stopped = true;
  }
}

/** A rectangle of the atlas whose corners keep their size and whose edges/centre stretch. */
class NineSlice {
  x: number; y: number; w: number; h: number;
  left: number; top: number; right: number; bottom: number;

  constructor(
    rect: { x: number; y: number; w: number; h: number },
    insets: { left: number; top: number; right: number; bottom: number },
  ) {
    ({ x: this.x, y: this.y, w: this.w, h: this.h } = rect);
    ({ left: this.left, top: this.top, right: this.right, bottom: this.bottom } = insets);
  }
}

/** Region table for public/atlas.svg. Coordinates are atlas pixels. */
const atlas = {
  url: '/atlas.svg',
  size: 512,
  /** Centre of a solid white block; solid quads sample only this texel. */
  white: { x: 4, y: 4 },
  button: new NineSlice({ x: 16, y: 16, w: 64, h: 52 }, { left: 12, top: 12, right: 12, bottom: 20 }),
  buttonHover: new NineSlice({ x: 96, y: 16, w: 64, h: 52 }, { left: 12, top: 12, right: 12, bottom: 20 }),
  buttonDown: new NineSlice({ x: 176, y: 16, w: 64, h: 52 }, { left: 12, top: 12, right: 12, bottom: 20 }),
};

// Placeholder until glyphs live in the atlas: measure with the browser's Arial 16.
const TEXT_LINE_HEIGHT = 18;
let textCtx: CanvasRenderingContext2D | null = null;
function measureText(text: string) {
  textCtx ??= document.createElement('canvas').getContext('2d')!;
  textCtx.font = '16px Arial';
  return { w: Math.ceil(textCtx.measureText(text).width), h: TEXT_LINE_HEIGHT };
}

function paddingOf(box: UIBox) {
  const p = box.padding;
  if (typeof p === 'number') return { t: p, r: p, b: p, l: p };
  if (p.length === 2) return { t: p[0], r: p[1], b: p[0], l: p[1] };
  return { t: p[0], r: p[1], b: p[2], l: p[3] };
}

class UIBox {
  layout: ILayout = flex;
  direction = Direction.Row;
  mainAlign = Alignment.Start;
  crossAlign = Alignment.Start;
  alignSelf: Alignment | null = null;
  flex = 0;
  gap = 0;
  padding: Padding = 0;
  width: number | null = null;
  height: number | null = null;
  bg: NineSlice | null = null;
  color: string | null = null;
  text: string | null = null;
  cursor: string | null = null;
  onClick: BoxEventHandler | null = null;

  // Maintained by the Surface; true for every box on the pointer's hit path.
  hovered = false;
  pressed = false;

  parent: UIBox | null = null;
  children: UIBox[] = [];
  /** Set on the root box only. */
  surface: Surface | null = null;

  // Written by measure().
  minW = 0;
  minH = 0;
  // Written by the parent's arrange(). Absolute, in CSS pixels.
  x = 0;
  y = 0;
  w = 0;
  h = 0;

  constructor(props: BoxProps = {}) {
    this.set(props);
  }

  set(props: BoxProps): this {
    const { children, ...rest } = props;
    Object.assign(this, rest);
    if (children) {
      for (const c of this.children) c.parent = null;
      this.children = [];
      this.add(...children);
    }
    this.invalidate();
    return this;
  }

  add(...kids: UIBox[]): this {
    for (const k of kids) {
      k.parent?.remove(k);
      k.parent = this;
      this.children.push(k);
    }
    this.invalidate();
    return this;
  }

  remove(kid: UIBox): this {
    const i = this.children.indexOf(kid);
    if (i >= 0) {
      this.children.splice(i, 1);
      kid.parent = null;
      this.invalidate();
    }
    return this;
  }

  invalidate() {
    let b: UIBox = this;
    while (b.parent) b = b.parent;
    b.surface?.requestRender();
  }

  private listeners: Partial<Record<BoxEventType, BoxEventHandler[]>> = {};

  on(type: BoxEventType, fn: BoxEventHandler): this {
    (this.listeners[type] ??= []).push(fn);
    return this;
  }

  off(type: BoxEventType, fn: BoxEventHandler): this {
    const list = this.listeners[type];
    const i = list ? list.indexOf(fn) : -1;
    if (i >= 0) list!.splice(i, 1);
    return this;
  }

  /** Runs this box's handlers only; bubbling is the Surface's job. */
  emit(e: BoxEvent) {
    e.current = this;
    for (const fn of this.listeners[e.type] ?? []) fn(e);
    if (e.type === 'click') this.onClick?.(e);
  }
}

const flex: ILayout = {
  measure(box) {
    const row = box.direction === Direction.Row;
    let main = 0;
    let cross = 0;
    for (const c of box.children) {
      c.layout.measure(c);
      main += row ? c.minW : c.minH;
      cross = Math.max(cross, row ? c.minH : c.minW);
    }
    main += box.gap * Math.max(0, box.children.length - 1);
    let contentW = row ? main : cross;
    let contentH = row ? cross : main;
    if (box.text) {
      const t = measureText(box.text);
      contentW = Math.max(contentW, t.w);
      contentH = Math.max(contentH, t.h);
    }
    const p = paddingOf(box);
    const bg = box.bg;
    box.minW = Math.max(box.width ?? 0, bg ? bg.left + bg.right : 0, contentW + p.l + p.r);
    box.minH = Math.max(box.height ?? 0, bg ? bg.top + bg.bottom : 0, contentH + p.t + p.b);
  },

  arrange(box) {
    const kids = box.children;
    if (!kids.length) return;
    const row = box.direction === Direction.Row;
    const p = paddingOf(box);
    const innerMain = row ? box.w - p.l - p.r : box.h - p.t - p.b;
    const innerCross = row ? box.h - p.t - p.b : box.w - p.l - p.r;

    // Main axis: start from min sizes, then hand out the free space.
    const sizes = kids.map(c => (row ? c.minW : c.minH));
    let free = innerMain - sizes.reduce((a, b) => a + b, 0) - box.gap * (kids.length - 1);
    let lead = 0;
    if (free > 0) {
      const totalFlex = kids.reduce((a, c) => a + c.flex, 0);
      if (totalFlex > 0) {
        kids.forEach((c, i) => (sizes[i] += (free * c.flex) / totalFlex));
      } else {
        switch (box.mainAlign) {
          case Alignment.Center: lead = free / 2; break;
          case Alignment.End: lead = free; break;
          case Alignment.Stretch: sizes.forEach((_, i) => (sizes[i] += free / kids.length)); break;
        }
      }
    }

    let pos = (row ? box.x + p.l : box.y + p.t) + lead;
    const crossStart = row ? box.y + p.t : box.x + p.l;
    kids.forEach((c, i) => {
      const align = c.alignSelf ?? box.crossAlign;
      const minCross = row ? c.minH : c.minW;
      const cs = align === Alignment.Stretch ? Math.max(innerCross, minCross) : minCross;
      const co = align === Alignment.Center ? (innerCross - cs) / 2 : align === Alignment.End ? innerCross - cs : 0;
      if (row) {
        c.x = pos; c.y = crossStart + co; c.w = sizes[i]; c.h = cs;
      } else {
        c.x = crossStart + co; c.y = pos; c.w = cs; c.h = sizes[i];
      }
      c.layout.arrange(c);
      pos += sizes[i] + box.gap;
    });
  },
};

// ---------------------------------------------------------------------------
// Rendering

const VERT = `#version 300 es
in vec2 aPos;
in vec2 aUV;
in vec4 aColor;
uniform vec2 uViewport;
out vec2 vUV;
out vec4 vColor;
void main() {
  vec2 p = aPos / uViewport * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  vUV = aUV;
  vColor = aColor;
}`;

// The atlas is uploaded premultiplied, so the tint is premultiplied here too.
const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
in vec2 vUV;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = texture(uAtlas, vUV) * vec4(vColor.rgb * vColor.a, vColor.a); }`;

const FLOATS_PER_VERTEX = 8; // x, y, u, v, r, g, b, a
const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * 6;
const WHITE = [1, 1, 1, 1];

const colorCache = new Map<string, number[]>();
function parseColor(hex: string): number[] {
  let c = colorCache.get(hex);
  if (c) return c;
  let s = hex.replace('#', '');
  if (s.length <= 4) s = [...s].map(ch => ch + ch).join('');
  if (s.length === 6) s += 'ff';
  c = [0, 2, 4, 6].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
  colorCache.set(hex, c);
  return c;
}

function compileProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
  return prog;
}

/** Owns a canvas and a root box. Re-lays-out and redraws when something invalidates. */
class Surface {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  vbo: WebGLBuffer;
  texture: WebGLTexture;
  uViewport: WebGLUniformLocation;
  data = new Float32Array(FLOATS_PER_QUAD * 256);
  atlasReady = false;
  renderCount = 0;
  onRender: ((s: Surface) => void) | null = null;
  private pending = false;
  /** root..target under the pointer, as of the last pointer event. */
  private hoverPath: UIBox[] = [];
  /** root..target that received pointerdown; empty when the primary button is up. */
  private pressPath: UIBox[] = [];

  constructor(public canvas: HTMLCanvasElement, public root: UIBox) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.prog = compileProgram(gl, VERT, FRAG);
    this.uViewport = gl.getUniformLocation(this.prog, 'uViewport')!;
    this.vbo = gl.createBuffer()!;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = FLOATS_PER_VERTEX * 4;
    const attrib = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    };
    attrib('aPos', 2, 0);
    attrib('aUV', 2, 2);
    attrib('aColor', 4, 4);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.texture = gl.createTexture()!;
    const img = new Image(atlas.size, atlas.size);
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.atlasReady = true;
      this.requestRender();
    };
    img.src = atlas.url;

    root.surface = this;
    new ResizeObserver(() => this.requestRender()).observe(canvas);

    canvas.addEventListener('pointermove', e => this.onPointerMove(e));
    canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    canvas.addEventListener('pointerup', e => this.onPointerUp(e, true));
    canvas.addEventListener('pointercancel', e => this.onPointerUp(e, false));
    canvas.addEventListener('pointerleave', e => {
      if (!this.pressPath.length) this.updateHover([], ...this.toLocal(e));
    });
  }

  // --- input

  private toLocal(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Walks down from the root, taking the topmost (last) child under the point at each level. */
  hitTest(x: number, y: number): UIBox[] {
    const inside = (b: UIBox) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
    const path: UIBox[] = [];
    let b: UIBox | null = inside(this.root) ? this.root : null;
    while (b) {
      path.push(b);
      const kids: UIBox[] = b.children;
      b = null;
      for (let i = kids.length - 1; i >= 0; i--) {
        if (inside(kids[i])) { b = kids[i]; break; }
      }
    }
    return path;
  }

  /** Dispatches from the end of the path towards the root until stopped. */
  private bubble(path: UIBox[], type: BoxEventType, x: number, y: number) {
    if (!path.length) return;
    const e = new BoxEvent(type, x, y, path[path.length - 1]);
    for (let i = path.length - 1; i >= 0 && !e.stopped; i--) path[i].emit(e);
  }

  private updateHover(path: UIBox[], x: number, y: number) {
    const old = this.hoverPath;
    this.hoverPath = path;
    for (let i = old.length - 1; i >= 0; i--) {
      const b = old[i];
      if (path.includes(b)) continue;
      b.hovered = false;
      b.emit(new BoxEvent('pointerleave', x, y, b));
    }
    for (const b of path) {
      if (old.includes(b)) continue;
      b.hovered = true;
      b.emit(new BoxEvent('pointerenter', x, y, b));
    }
    let cursor = '';
    for (const b of path) if (b.cursor) cursor = b.cursor;
    this.canvas.style.cursor = cursor;
  }

  private onPointerMove(e: PointerEvent) {
    const [x, y] = this.toLocal(e);
    this.updateHover(this.hitTest(x, y), x, y);
    this.bubble(this.pressPath.length ? this.pressPath : this.hoverPath, 'pointermove', x, y);
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const [x, y] = this.toLocal(e);
    const path = this.hitTest(x, y);
    this.updateHover(path, x, y);
    if (!path.length) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pressPath = path;
    for (const b of path) b.pressed = true;
    this.bubble(path, 'pointerdown', x, y);
  }

  private onPointerUp(e: PointerEvent, allowClick: boolean) {
    if (!this.pressPath.length) return;
    const [x, y] = this.toLocal(e);
    const pressed = this.pressPath;
    this.pressPath = [];
    for (const b of pressed) b.pressed = false;
    this.bubble(pressed, 'pointerup', x, y);

    const path = this.hitTest(x, y);
    if (allowClick) {
      // Click goes to the deepest box that got both the down and the up.
      let n = 0;
      while (n < path.length && n < pressed.length && path[n] === pressed[n]) n++;
      this.bubble(path.slice(0, n), 'click', x, y);
    }
    this.updateHover(e.type === 'pointercancel' ? [] : path, x, y);
  }

  /** Coalesces any number of invalidations in the same task into one render. */
  requestRender() {
    if (this.pending || !this.atlasReady) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.render();
    });
  }

  render() {
    const { gl, canvas, root } = this;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    root.layout.measure(root);
    root.x = 0;
    root.y = 0;
    root.w = cssW;
    root.h = cssH;
    root.layout.arrange(root);

    let n = 0;
    const visit = (b: UIBox) => {
      if (b.bg) n = this.pushNineSlice(n, b, b.bg, b.color ? parseColor(b.color) : WHITE);
      else if (b.color) n = this.pushQuad(n, b.x, b.y, b.x + b.w, b.y + b.h, atlas.white.x, atlas.white.y, atlas.white.x, atlas.white.y, parseColor(b.color));
      for (const c of b.children) visit(c);
    };
    visit(root);

    gl.viewport(0, 0, pxW, pxH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.uViewport, cssW, cssH);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, n), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, n / FLOATS_PER_VERTEX);

    this.renderCount++;
    this.onRender?.(this);
  }

  private pushNineSlice(n: number, b: UIBox, s: NineSlice, color: number[]) {
    // If the box is smaller than the fixed corners, shrink the corners proportionally.
    const kx = Math.min(1, b.w / (s.left + s.right || 1));
    const ky = Math.min(1, b.h / (s.top + s.bottom || 1));
    const xs = [b.x, b.x + s.left * kx, b.x + b.w - s.right * kx, b.x + b.w];
    const ys = [b.y, b.y + s.top * ky, b.y + b.h - s.bottom * ky, b.y + b.h];
    const us = [s.x, s.x + s.left, s.x + s.w - s.right, s.x + s.w];
    const vs = [s.y, s.y + s.top, s.y + s.h - s.bottom, s.y + s.h];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        if (xs[i + 1] <= xs[i] || ys[j + 1] <= ys[j]) continue;
        n = this.pushQuad(n, xs[i], ys[j], xs[i + 1], ys[j + 1], us[i], vs[j], us[i + 1], vs[j + 1], color);
      }
    }
    return n;
  }

  /** Positions in CSS pixels, UVs in atlas pixels. */
  private pushQuad(
    n: number, x0: number, y0: number, x1: number, y1: number,
    u0: number, v0: number, u1: number, v1: number, [r, g, b, a]: number[],
  ) {
    if (n + FLOATS_PER_QUAD > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    const k = 1 / atlas.size;
    u0 *= k; v0 *= k; u1 *= k; v1 *= k;
    for (const [x, y, u, v] of [[x0, y0, u0, v0], [x1, y0, u1, v0], [x0, y1, u0, v1], [x0, y1, u0, v1], [x1, y0, u1, v0], [x1, y1, u1, v1]]) {
      this.data.set([x, y, u, v, r, g, b, a], n);
      n += FLOATS_PER_VERTEX;
    }
    return n;
  }
}

const UI = { UIBox, NineSlice, BoxEvent, Surface, Alignment, Direction, atlas, layouts: { flex } };
Object.assign(window, { UI, UIBox, NineSlice, BoxEvent, Alignment, Direction });

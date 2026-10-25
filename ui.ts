// Tiny retained-mode UI on WebGL. Renders only on demand (no RAF loop).
//
// This file is deliberately a global script (no import/export) so its declarations
// are visible to demo.ts for type checking; at runtime we put them on `window`.

enum Alignment { Start, Center, End, Stretch }
enum Direction { Row, Column }

interface ILayout {
  /** Pass 1, bottom-up: compute box.minW / box.minH (recursing into children as needed). */
  measure(box: UIBox): void;
  /** Pass 2, top-down: box.x/y/w/h are final; size and place the children, then recurse. */
  arrange(box: UIBox): void;
}

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
  padding?: number;
  /** Fixed minimum size; content can still make the box larger. */
  width?: number | null;
  height?: number | null;
  color?: string | null;
  children?: UIBox[];
}

class UIBox {
  layout: ILayout = flex;
  direction = Direction.Row;
  mainAlign = Alignment.Start;
  crossAlign = Alignment.Start;
  alignSelf: Alignment | null = null;
  flex = 0;
  gap = 0;
  padding = 0;
  width: number | null = null;
  height: number | null = null;
  color: string | null = null;

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
    const pad = box.padding * 2;
    box.minW = Math.max(box.width ?? 0, (row ? main : cross) + pad);
    box.minH = Math.max(box.height ?? 0, (row ? cross : main) + pad);
  },

  arrange(box) {
    const kids = box.children;
    if (!kids.length) return;
    const row = box.direction === Direction.Row;
    const p = box.padding;
    const innerMain = (row ? box.w : box.h) - 2 * p;
    const innerCross = (row ? box.h : box.w) - 2 * p;

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

    let pos = (row ? box.x : box.y) + p + lead;
    const crossStart = (row ? box.y : box.x) + p;
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
in vec4 aColor;
uniform vec2 uViewport;
out vec4 vColor;
void main() {
  vec2 p = aPos / uViewport * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  vColor = aColor;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }`;

const FLOATS_PER_VERTEX = 6; // x, y, r, g, b, a
const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * 6;

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
  uViewport: WebGLUniformLocation;
  data = new Float32Array(FLOATS_PER_QUAD * 256);
  renderCount = 0;
  onRender: ((s: Surface) => void) | null = null;
  private pending = false;

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
    const aPos = gl.getAttribLocation(this.prog, 'aPos');
    const aColor = gl.getAttribLocation(this.prog, 'aColor');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 8);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    root.surface = this;
    new ResizeObserver(() => this.requestRender()).observe(canvas);
    this.requestRender();
  }

  /** Coalesces any number of invalidations in the same task into one render. */
  requestRender() {
    if (this.pending) return;
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
      if (b.color) n = this.pushQuad(n, b.x, b.y, b.w, b.h, parseColor(b.color));
      for (const c of b.children) visit(c);
    };
    visit(root);

    gl.viewport(0, 0, pxW, pxH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.uViewport, cssW, cssH);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, n), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, n / FLOATS_PER_VERTEX);

    this.renderCount++;
    this.onRender?.(this);
  }

  private pushQuad(n: number, x: number, y: number, w: number, h: number, [r, g, b, a]: number[]) {
    if (n + FLOATS_PER_QUAD > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    const x1 = x + w;
    const y1 = y + h;
    for (const [vx, vy] of [[x, y], [x1, y], [x, y1], [x, y1], [x1, y], [x1, y1]]) {
      this.data.set([vx, vy, r, g, b, a], n);
      n += FLOATS_PER_VERTEX;
    }
    return n;
  }
}

const UI = { UIBox, Surface, Alignment, Direction, layouts: { flex } };
Object.assign(window, { UI, UIBox, Alignment, Direction });

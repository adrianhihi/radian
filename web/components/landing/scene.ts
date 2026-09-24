// Landing visual: the ice-cave image sequence with depth-map parallax.
//
// 120 colour frames and 120 depth frames, self-hosted under /cave. Scroll
// progress picks the frame (the camera moving through the cave); the pointer
// displaces UVs by the depth map (parallax). Loading: the first 9 frames block
// the intro, the rest backfill in small batches; `nearest()` falls back to the
// closest loaded frame so scrolling ahead never shows black.
import { frameIndex } from "@/lib/landing";

export const FRAME_COUNT = 120;
/** Frames the intro waits for (first + 8 to keep the opening scroll smooth). */
export const PRIME_COUNT = 9;

const pad = (n: number) => String(n).padStart(3, "0");
export const colorSrc = (i: number) => `/cave/c${pad(i)}.webp`;
export const depthSrc = (i: number) => `/cave/d${pad(i)}.webp`;

const STRENGTH_X = 0.0144;
const STRENGTH_Y = 0.0108;
const POINTER_SMOOTHING = 0.055;

const VERT = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uPointer;
uniform vec2 uStrength;
uniform vec2 uCover;
varying vec2 vUv;
void main() {
  vec2 uv = (vUv - 0.5) * uCover + 0.5;
  float depth = texture2D(uDepth, uv).r;
  float centered = (depth - 0.5) * 2.0;
  vec2 displaced = uv + uPointer * uStrength * centered;
  displaced = clamp(displaced, vec2(0.008), vec2(0.992));
  gl_FragColor = texture2D(uColor, displaced);
}`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`frame failed: ${src}`));
    img.src = src;
  });
}

export class FrameStore {
  readonly color: (HTMLImageElement | undefined)[] = new Array(FRAME_COUNT);
  readonly depth: (HTMLImageElement | undefined)[] = new Array(FRAME_COUNT);
  private readonly pending = new Map<number, Promise<void>>();
  private loaded = 0;
  private failed = 0;
  private stopped = false;

  get ratio(): number {
    return this.loaded / FRAME_COUNT;
  }

  /** The intro's real progress: processed frames / PRIME_COUNT (failures count, so the bar never sticks). */
  get primeRatio(): number {
    return Math.min(1, (this.loaded + this.failed) / PRIME_COUNT);
  }

  /** Load one frame. Never rejects: a missing frame is covered by nearest(). */
  load(i: number): Promise<void> {
    const k = Math.max(0, Math.min(FRAME_COUNT - 1, i));
    if (this.color[k] && this.depth[k]) return Promise.resolve();
    const inflight = this.pending.get(k);
    if (inflight) return inflight;
    const p = Promise.all([loadImage(colorSrc(k)), loadImage(depthSrc(k))])
      .then(([c, d]) => {
        this.color[k] = c;
        this.depth[k] = d;
        this.loaded += 1;
      })
      .catch(() => {
        this.failed += 1;
      })
      .finally(() => {
        this.pending.delete(k);
      });
    this.pending.set(k, p);
    return p;
  }

  async prime(): Promise<void> {
    await this.load(0);
    await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => this.load(i)));
  }

  /** Backfill the rest in batches of 4, yielding between batches. */
  backfill(): void {
    const rest = Array.from({ length: FRAME_COUNT - PRIME_COUNT }, (_, i) => i + PRIME_COUNT);
    let at = 0;
    const step = () => {
      if (this.stopped || at >= rest.length) return;
      const batch = rest.slice(at, at + 4).map((i) => this.load(i));
      at += 4;
      void Promise.allSettled(batch).then(() => {
        if (!this.stopped) setTimeout(step, 20);
      });
    };
    step();
  }

  nearest(i: number): number {
    if (this.color[i] && this.depth[i]) return i;
    for (let d = 1; d < FRAME_COUNT; d += 1) {
      for (const k of [i - d, i + d]) {
        if (k >= 0 && k < FRAME_COUNT && this.color[k] && this.depth[k]) return k;
      }
    }
    return -1;
  }

  dispose(): void {
    this.stopped = true;
  }
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader compile failed");
  return sh;
}

export class CaveScene {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly colorTex: WebGLTexture;
  private readonly depthTex: WebGLTexture;
  private readonly u: { pointer: WebGLUniformLocation | null; strength: WebGLUniformLocation | null; cover: WebGLUniformLocation | null };
  private readonly reduced: boolean;
  private pointerTarget = { x: 0, y: 0 };
  private pointer = { x: 0, y: 0 };
  private current = -1;
  private imageW = 16;
  private imageH = 9;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly frames: FrameStore,
    reducedMotion = false,
  ) {
    this.reduced = reducedMotion;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;

    const program = gl.createProgram();
    if (!program) throw new Error("createProgram failed");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
    this.program = program;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("createBuffer failed");
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {
      pointer: gl.getUniformLocation(program, "uPointer"),
      strength: gl.getUniformLocation(program, "uStrength"),
      cover: gl.getUniformLocation(program, "uCover"),
    };
    this.colorTex = this.makeTexture(0, "uColor");
    this.depthTex = this.makeTexture(1, "uDepth");
    gl.uniform2f(this.u.strength, STRENGTH_X, STRENGTH_Y);
  }

  private makeTexture(unit: number, name: string): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("createTexture failed");
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // non-power-of-two frames: CLAMP_TO_EDGE + non-mipmap filters, or WebGL1 samples black
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(this.program, name), unit);
    return tex;
  }

  private upload(tex: WebGLTexture, unit: number, img: HTMLImageElement) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  }

  setPointer(x: number, y: number) {
    if (this.reduced) return; // parallax is decoration, and the kind of motion that causes discomfort
    this.pointerTarget.x = x;
    this.pointerTarget.y = y;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w > 0 && h > 0 && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
    const r = this.canvas.width / Math.max(1, this.canvas.height);
    const a = this.imageW / Math.max(1, this.imageH);
    this.gl.uniform2f(this.u.cover, r > a ? 1 : r / a, r > a ? a / r : 1);
  }

  frameFor(progress: number): number {
    return frameIndex(progress, FRAME_COUNT);
  }

  render(progress: number) {
    const want = this.frameFor(progress);
    const i = this.frames.nearest(want);
    if (i < 0) return;
    if (i !== this.current) {
      const c = this.frames.color[i];
      const d = this.frames.depth[i];
      if (!c || !d) return;
      this.imageW = c.naturalWidth;
      this.imageH = c.naturalHeight;
      this.upload(this.colorTex, 0, c);
      this.upload(this.depthTex, 1, d);
      this.current = i;
      this.resize();
    }
    this.pointer.x += (this.pointerTarget.x - this.pointer.x) * POINTER_SMOOTHING;
    this.pointer.y += (this.pointerTarget.y - this.pointer.y) * POINTER_SMOOTHING;
    this.gl.uniform2f(this.u.pointer, this.pointer.x, this.pointer.y);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteTexture(this.colorTex);
    gl.deleteTexture(this.depthTex);
    gl.deleteProgram(this.program);
    // hand the context back: the landing is one route in an SPA, and browsers cap WebGL contexts
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

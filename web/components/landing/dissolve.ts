// Intro overlay dissolve: an fbm noise field thresholded from the centre
// outward, with a bright rim on the dissolve edge. Drawn over the CSS frost
// surface; together they read as the ice melting away to reveal the cave.

const VERT = `
attribute vec2 aPosition;
varying vec2 vUv;
void main(){
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2  uResolution;
uniform float uProgress;
uniform float uTime;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + vec2(13.7, 8.4); a *= 0.5; }
  return v;
}
void main(){
  vec2 uv = vUv;
  vec2 p = uv - 0.5;
  p.x *= uResolution.x / uResolution.y;
  float n = fbm(uv * 3.1 + vec2(uTime * 0.035, -uTime * 0.025));
  float detail = fbm(uv * 8.4 - vec2(uTime * 0.02));
  float field = length(p) + (n - 0.5) * 0.24 + (detail - 0.5) * 0.065;
  float threshold = mix(-0.22, 1.05, uProgress);
  float edge = 0.045;
  float alpha = smoothstep(threshold - edge, threshold + edge, field);
  float rim = 1.0 - smoothstep(0.006, 0.052, abs(field - threshold));
  float coverage = max(alpha, rim * 0.18);
  vec3 base = vec3(0.055, 0.105, 0.17);            /* the ice's deep blue */
  vec3 col = mix(base, vec3(0.56, 0.78, 1.0), rim * 0.72); /* melting edge glows blue-white */
  gl_FragColor = vec4(col * coverage, coverage);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "dissolve shader compile failed");
  return sh;
}

export class Dissolve {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly uProgress: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;
  private readonly uResolution: WebGLUniformLocation | null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;
    const program = gl.createProgram();
    if (!program) throw new Error("createProgram failed");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "dissolve link failed");
    gl.useProgram(program);
    this.program = program;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("createBuffer failed");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.buffer = buffer;
    this.uProgress = gl.getUniformLocation(program, "uProgress");
    this.uTime = gl.getUniformLocation(program, "uTime");
    this.uResolution = gl.getUniformLocation(program, "uResolution");
    this.resize();
    this.render(0);
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
    this.gl.uniform2f(this.uResolution, w, h);
  }

  render(progress: number) {
    this.resize();
    this.gl.uniform1f(this.uProgress, progress);
    this.gl.uniform1f(this.uTime, performance.now() / 1000);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  /** Play the dissolve once; resolves when the overlay is fully clear. */
  play(duration: number): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.render(eased);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

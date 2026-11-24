const canvas = document.querySelector('#water');
const message = document.querySelector('#message');
const lightingButton = document.querySelector('#lighting');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const lightingModes = [
  { label: '白天', phase: 'day', canvasLabel: '阳光下缓缓流动的河面', weights: [1, 0, 0] },
  { label: '傍晚', phase: 'sunset', canvasLabel: '夕阳下缓缓流动的河面', weights: [0, 1, 0] },
  { label: '夜晚', phase: 'night', canvasLabel: '月光下缓缓流动的河面', weights: [0, 0, 1] }
];

const vertexShader = `#version 300 es
void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragmentShader = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uLighting;
uniform sampler2D uBedColor;
uniform sampler2D uBedNormal;
out vec4 outColor;

float randomValue(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}

// Value and analytical gradient of smooth two-dimensional noise.
vec3 noiseWithGradient(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 blend = f * f * (3.0 - 2.0 * f);
  vec2 slope = 6.0 * f * (1.0 - f);
  float a = randomValue(cell);
  float b = randomValue(cell + vec2(1.0, 0.0));
  float c = randomValue(cell + vec2(0.0, 1.0));
  float d = randomValue(cell + vec2(1.0, 1.0));
  float value = mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  vec2 gradient = vec2(
    mix(b - a, d - c, blend.y) * slope.x,
    mix(c - a, d - b, blend.x) * slope.y
  );
  return vec3(value, gradient);
}

vec3 riverbed(vec2 p) {
  vec2 uv = p * 0.5;
  vec3 color = texture(uBedColor, uv).rgb;
  vec3 tangentNormal = texture(uBedNormal, uv).rgb * 2.0 - 1.0;
  vec3 bedNormal = normalize(vec3(tangentNormal.x, tangentNormal.z, tangentNormal.y));
  float illumination = 0.65 + 0.5 * max(dot(bedNormal, normalize(vec3(0.3, 0.85, 0.4))), 0.0);
  return color * illumination;
}

void main() {
  vec2 screen = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
  vec3 ray = normalize(vec3(screen.x * 0.50, -0.34 + screen.y * 0.27, 1.0));
  vec2 point = ray.xz * (0.9 / -ray.y);

  vec2 gradient = vec2(0.0);
  float frequency = 4.0;
  float strength = 0.22;
  for (int i = 0; i < 5; i++) {
    float layer = float(i);
    vec2 drift = vec2(0.28 + layer * 0.09, 0.65 - layer * 0.08) * uTime;
    vec3 n = noiseWithGradient(point * frequency + vec2(float(i) * 13.7) + drift);
    float visibility = 1.0 - smoothstep(0.3, 0.9, length(fwidth(point * frequency)));
    gradient += n.yz * strength * visibility;
    frequency *= 2.0;
    strength *= 0.7;
  }

  float wave = dot(point, vec2(2.4, 4.0)) - uTime * 1.1
    + 0.7 * sin(point.x * 1.8 + uTime * 0.35);
  gradient += cos(wave) * vec2(2.4 + 1.26 * cos(point.x * 1.8 + uTime * 0.35), 4.0) * 0.014;
  float crossWave = dot(point, vec2(-3.8, 2.2)) - uTime * 0.8;
  gradient += cos(crossWave) * vec2(-3.8, 2.2) * 0.010;
  vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
  vec3 reflected = reflect(ray, normal);
  vec3 lightDirection = normalize(
    vec3(0.11, 0.48, 0.87) * uLighting.x
    + vec3(0.11, 0.29, 0.95) * uLighting.y
    + vec3(0.08, 0.35, 0.93) * uLighting.z
  );

  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-ray, normal), 0.0), 5.0);
  float skyMix = smoothstep(-0.2, 0.9, reflected.y);
  vec3 sky = mix(vec3(0.30, 0.46, 0.66), vec3(0.50, 0.64, 0.80), skyMix);
  vec3 sunsetSky = mix(vec3(0.90, 0.40, 0.16), vec3(1.15, 0.68, 0.29), skyMix);
  vec3 nightSky = mix(vec3(0.025, 0.045, 0.10), vec3(0.08, 0.13, 0.23), skyMix);
  sky = sky * uLighting.x + sunsetSky * uLighting.y + nightSky * uLighting.z;

  vec3 refractionNormal = normalize(vec3(-gradient.x * 0.65, 1.0, -gradient.y * 0.65));
  vec3 transmitted = refract(ray, refractionNormal, 1.0 / 1.333);
  float depth = mix(0.3, 0.6, noiseWithGradient(point * 0.7).x);
  float waterDistance = depth / max(-transmitted.y, 0.05);
  vec2 bottomPoint = point + transmitted.xz * waterDistance;
  vec3 bottom = riverbed(bottomPoint);
  bottom *= 0.92 + 0.16 * noiseWithGradient(bottomPoint * 3.0 + vec2(uTime * 0.2, -uTime * 0.1)).x;
  vec3 transmission = exp(-vec3(1.2, 0.35, 0.10) * waterDistance);
  vec3 underwater = mix(vec3(0.025, 0.11, 0.24), bottom * vec3(0.58, 0.73, 1.02), transmission);
  underwater *= vec3(1.0) * uLighting.x
    + vec3(0.95, 0.85, 0.85) * uLighting.y
    + vec3(0.25, 0.35, 0.52) * uLighting.z;
  vec3 color = mix(underwater, sky, fresnel);

  float sunAlignment = max(dot(reflected, lightDirection), 0.0);
  float glint = pow(sunAlignment, mix(110.0, 80.0, uLighting.y));
  float glow = pow(sunAlignment, 18.0);
  vec3 lightColor = vec3(1.0, 0.84, 0.61) * uLighting.x
    + vec3(1.0, 0.67, 0.24) * uLighting.y
    + vec3(0.72, 0.82, 1.0) * uLighting.z;
  float glintStrength = dot(vec3(1.8, 4.5, 0.65), uLighting);
  float glowStrength = dot(vec3(0.11, 0.27, 0.035), uLighting);
  color += lightColor * (glint * glintStrength + glow * glowStrength);

  color = color / (1.0 + color);
  color = pow(color, vec3(1.0 / 2.2));
  outColor = vec4(color, 1.0);
}`;

let gl;
let program;
let resolutionLocation;
let timeLocation;
let lightingLocation;
let frame = 0;
let startTime = 0;
let elapsed = 0;
let quality = 1;
let sampleStart = 0;
let sampleFrames = 0;
let contextLost = false;
let bedColorImage;
let bedNormalImage;
let lightingIndex = 0;
let lightingFrom = lightingModes[0].weights;
let lightingStarted = 0;

function showError(text, error) {
  if (error) console.error(error);
  lightingButton.disabled = true;
  message.textContent = text;
  message.hidden = false;
  cancelAnimationFrame(frame);
  frame = 0;
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${detail}`);
  }
  return shader;
}

function bindTexture(image, unit, uniformName, isColor) {
  const texture = gl.createTexture();
  if (!texture) throw new Error(`Unable to create ${uniformName} texture`);
  const location = gl.getUniformLocation(program, uniformName);
  if (location === null) throw new Error(`Missing ${uniformName} uniform`);
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, isColor ? gl.SRGB8_ALPHA8 : gl.RGBA,
    gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.uniform1i(location, unit);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`Unable to upload ${uniformName}: WebGL error ${error}`);
}

function initialize() {
  gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
  if (!gl) {
    showError('当前浏览器不支持 WebGL 2，无法显示水面。请尝试更新浏览器或启用硬件加速。');
    return false;
  }

  try {
    const vertex = compileShader(gl.VERTEX_SHADER, vertexShader);
    const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentShader);
    program = gl.createProgram();
    if (!program) throw new Error('Unable to create shader program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader linking failed: ${gl.getProgramInfoLog(program)}`);
    }
    resolutionLocation = gl.getUniformLocation(program, 'uResolution');
    timeLocation = gl.getUniformLocation(program, 'uTime');
    lightingLocation = gl.getUniformLocation(program, 'uLighting');
    if (resolutionLocation === null || timeLocation === null || lightingLocation === null) {
      throw new Error('Required shader uniforms are missing');
    }
    gl.useProgram(program);
    bindTexture(bedColorImage, 0, 'uBedColor', true);
    bindTexture(bedNormalImage, 1, 'uBedNormal', false);
    message.hidden = true;
    lightingButton.disabled = false;
    resize();
    return true;
  } catch (error) {
    showError('水面渲染初始化失败。请检查浏览器的 WebGL 支持和控制台错误信息。', error);
    return false;
  }
}

function resize() {
  if (!gl || contextLost) return;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const pixelLimit = Math.sqrt(2500000 / (width * height));
  const scale = Math.min(pixelRatio * quality, pixelLimit);
  const renderWidth = Math.max(1, Math.round(width * scale));
  const renderHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
}

function currentLighting(now) {
  const target = lightingModes[lightingIndex].weights;
  if (motionPreference.matches) return target;
  const progress = Math.min(1, Math.max(0, (now - lightingStarted) / 1800));
  const smooth = progress * progress * (3 - 2 * progress);
  return target.map((value, index) => lightingFrom[index] + (value - lightingFrom[index]) * smooth);
}

function draw(time) {
  gl.uniform1f(timeLocation, time);
  gl.uniform3fv(lightingLocation, currentLighting(performance.now()));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function tick(now) {
  frame = 0;
  if (!startTime) startTime = now;
  if (!sampleStart) sampleStart = now;
  draw(elapsed + (now - startTime) / 1000);
  sampleFrames++;

  const sampleDuration = now - sampleStart;
  if (sampleDuration >= 4000) {
    const fps = sampleFrames * 1000 / sampleDuration;
    if (fps < 48 && quality > 0.5) {
      quality = Math.max(0.5, quality - 0.15);
      resize();
    }
    sampleStart = now;
    sampleFrames = 0;
  }
  frame = requestAnimationFrame(tick);
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  if (startTime) elapsed += (performance.now() - startTime) / 1000;
  startTime = 0;
  sampleStart = 0;
  sampleFrames = 0;
}

function updatePlayback() {
  stop();
  if (!gl || contextLost || !message.hidden || document.hidden) return;
  resize();
  if (motionPreference.matches) {
    draw(elapsed);
  } else {
    frame = requestAnimationFrame(tick);
  }
}

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  stop();
  showError('图形渲染暂时中断，正在等待浏览器恢复。');
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  if (initialize()) updatePlayback();
});
window.addEventListener('resize', updatePlayback);
document.addEventListener('visibilitychange', updatePlayback);
motionPreference.addEventListener('change', () => {
  if (motionPreference.matches) lightingFrom = lightingModes[lightingIndex].weights;
  updatePlayback();
});
lightingButton.addEventListener('click', () => {
  const now = performance.now();
  lightingFrom = currentLighting(now);
  lightingIndex = (lightingIndex + 1) % lightingModes.length;
  const mode = lightingModes[lightingIndex];
  const next = lightingModes[(lightingIndex + 1) % lightingModes.length];
  if (motionPreference.matches) lightingFrom = mode.weights;
  lightingStarted = now;
  lightingButton.textContent = `${mode.label} → ${next.label}`;
  lightingButton.dataset.phase = mode.phase;
  lightingButton.setAttribute('aria-label', `当前${mode.label}，切换到${next.label}`);
  canvas.setAttribute('aria-label', mode.canvasLabel);
  updatePlayback();
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${url}`));
    image.src = url;
  });
}

message.textContent = '正在加载河床材质…';
message.hidden = false;
Promise.all([
  loadImage('assets/dry_river_pebbles_diff_1k.jpg'),
  loadImage('assets/dry_river_pebbles_nor_gl_1k.jpg')
]).then(([color, normal]) => {
  bedColorImage = color;
  bedNormalImage = normal;
  if (initialize()) updatePlayback();
}, (error) => {
  showError('河床材质加载失败，请检查资源文件和浏览器控制台。', error);
});

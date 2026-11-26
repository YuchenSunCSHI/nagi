import vertexSource from './water.vert.glsl?raw';
import fragmentSource from './water.frag.glsl?raw';
import { camera } from '../scene/camera';
import { appearance } from '../scene/appearance';

export interface Drop {
  x: number;
  z: number;
  time: number;
  strength: number;
}

export interface Wake extends Drop {
  endX: number;
  endZ: number;
  endTime: number;
  controlX: number;
  controlZ: number;
  path: object;
}

const textures = [
  ['uBedColor', true, true, new URL('../../assets/dry_river_pebbles_diff_1k.jpg', import.meta.url).href],
  ['uBedNormal', false, true, new URL('../../assets/dry_river_pebbles_nor_gl_1k.jpg', import.meta.url).href],
  ['uFish', true, false, new URL('../../assets/fish-trout.png', import.meta.url).href],
  ['uKoi', true, false, new URL('../../assets/fish-koi.png', import.meta.url).href],
  ['uBass', true, false, new URL('../../assets/fish-largemouth-bass.png', import.meta.url).href],
  ['uCatfish', true, false, new URL('../../assets/fish-channel-catfish.png', import.meta.url).href]
] as const;

export function loadWaterTextures() {
  return Promise.all(textures.map(([, , , url]) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${url}`));
    image.src = url;
  })));
}

export function createRenderer(gl: WebGL2RenderingContext, images: HTMLImageElement[], fishSeeds: Float32Array) {
  const compile = (type: number, source: string) => {
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
  };
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create shader program');
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader linking failed: ${gl.getProgramInfoLog(program)}`);
  }
  const uniform = (name: string) => {
    const location = gl.getUniformLocation(program, name);
    if (location === null) throw new Error(`Missing ${name} uniform`);
    return location;
  };
  const resolution = uniform('uResolution');
  const cameraPitch = uniform('uCameraPitch');
  const appearanceUniform = uniform('uAppearance');
  const time = uniform('uTime');
  const lighting = uniform('uLighting');
  const ripples = uniform('uRipples[0]');
  const rippleEnds = uniform('uRippleEnds[0]');
  const rippleControls = uniform('uRippleControls[0]');
  const rippleCount = uniform('uRippleCount');
  const drops = uniform('uDrops[0]');
  const dropCount = uniform('uDropCount');
  const fishMotion = uniform('uFishMotion[0]');
  gl.useProgram(program);
  gl.uniform2fv(uniform('uFishSeeds[0]'), fishSeeds);
  gl.uniform4f(uniform('uCameraShape'), camera.horizontalScale, camera.verticalScale, camera.horizonMargin, camera.height);
  textures.forEach(([name, color, repeat], unit) => {
    const texture = gl.createTexture();
    if (!texture) throw new Error(`Unable to create ${name} texture`);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, color ? gl.SRGB8_ALPHA8 : gl.RGBA,
      gl.RGBA, gl.UNSIGNED_BYTE, images[unit]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(uniform(name), unit);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`Unable to upload ${name}: WebGL error ${error}`);
  });

  const rippleUniforms = new Float32Array(20 * 4);
  const rippleEndUniforms = new Float32Array(20 * 4);
  const rippleControlUniforms = new Float32Array(20 * 2);
  const dropUniforms = new Float32Array(10 * 4);
  return {
    resize(width: number, height: number) {
      gl.viewport(0, 0, width, height);
      gl.uniform2f(resolution, width, height);
    },
    draw(seconds: number, light: number[], wakes: Wake[], points: Drop[], fish: Float32Array) {
      for (let i = 0; i < wakes.length; i++) {
        const wake = wakes[i];
        const first = i === 0 || wakes[i - 1].path !== wake.path;
        const last = i === wakes.length - 1 || wakes[i + 1].path !== wake.path;
        rippleUniforms.set([wake.x, wake.z, wake.time, wake.strength], i * 4);
        rippleEndUniforms.set([wake.endX, wake.endZ, wake.endTime, Number(first) + 2 * Number(last)], i * 4);
        rippleControlUniforms.set([wake.controlX, wake.controlZ], i * 2);
      }
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        dropUniforms.set([point.x, point.z, point.time, point.strength], i * 4);
      }
      gl.uniform1f(cameraPitch, camera.pitch);
      gl.uniform4f(appearanceUniform, appearance.skyBlue, appearance.distantTransition,
        appearance.reflection, appearance.daySparkle);
      gl.uniform1f(time, seconds);
      gl.uniform3fv(lighting, light);
      gl.uniform1i(rippleCount, wakes.length);
      if (wakes.length) {
        gl.uniform4fv(ripples, rippleUniforms);
        gl.uniform4fv(rippleEnds, rippleEndUniforms);
        gl.uniform2fv(rippleControls, rippleControlUniforms);
      }
      gl.uniform1i(dropCount, points.length);
      if (points.length) gl.uniform4fv(drops, dropUniforms);
      gl.uniform4fv(fishMotion, fish);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  };
}

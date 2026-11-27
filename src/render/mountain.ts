import vertex from './mountain.vert.glsl?raw';
import fragment from './mountain.frag.glsl?raw';
import { buildTerrain, terrainBounds, terrainSize } from './mountain-terrain';

export function createMountain(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true });
  if (!gl || gl.isContextLost()) throw new Error('Mountain scene requires WebGL 2');
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to allocate mountain program');
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to allocate mountain shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const detail = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Mountain shader compilation failed: ${detail}`);
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Mountain shader linking failed: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);
  const texture = gl.createTexture();
  const indexBuffer = gl.createBuffer();
  if (!texture || !indexBuffer) throw new Error('Unable to allocate mountain terrain');
  const { heights, indices } = buildTerrain();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, terrainSize, terrainSize, 0, gl.RED, gl.FLOAT, heights);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`Mountain terrain upload failed: ${error}`);
  gl.uniform4f(gl.getUniformLocation(program, 'uBounds'), ...terrainBounds);
  const resolution = gl.getUniformLocation(program, 'uResolution');
  const weights = gl.getUniformLocation(program, 'uWeights');
  const sky = gl.getUniformLocation(program, 'uSky');
  return {
    draw(blend: number[]) {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const scale = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(1500000 / (width * height)));
      const renderWidth = Math.max(1, Math.round(width * scale));
      const renderHeight = Math.max(1, Math.round(height * scale));
      if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
        canvas.width = renderWidth;
        canvas.height = renderHeight;
      }
      gl.viewport(0, 0, renderWidth, renderHeight);
      gl.uniform2f(resolution, renderWidth, renderHeight);
      gl.uniform3fv(weights, blend);
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1i(sky, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.uniform1i(sky, 0);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
    }
  };
}

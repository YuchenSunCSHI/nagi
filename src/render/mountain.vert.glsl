#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uHeight;
uniform vec4 uBounds;
uniform vec2 uResolution;
uniform bool uSky;
out vec3 vPosition;
out vec3 vNormal;

float elevation(ivec2 cell, ivec2 last) {
  return texelFetch(uHeight, clamp(cell, ivec2(0), last), 0).r;
}

void main() {
  if (uSky) {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    vPosition = vec3(0);
    vNormal = vec3(0, 1, 0);
    return;
  }
  ivec2 size = textureSize(uHeight, 0);
  ivec2 cell = ivec2(gl_VertexID % size.x, gl_VertexID / size.x);
  ivec2 last = size - 1;
  vec2 stepSize = uBounds.zw / vec2(last);
  vec2 xz = uBounds.xy + vec2(cell) * stepSize;
  vPosition = vec3(xz.x, elevation(cell, last), xz.y);
  float dx = elevation(cell + ivec2(1,0), last) - elevation(cell - ivec2(1,0), last);
  float dz = elevation(cell + ivec2(0,1), last) - elevation(cell - ivec2(0,1), last);
  vNormal = normalize(vec3(-dx / (2.0 * stepSize.x), 1.0, -dz / (2.0 * stepSize.y)));
  vec3 relative = vPosition - vec3(-0.25, 1.1, -7.3);
  float aspect = uResolution.x / uResolution.y;
  vec2 span = vec2(aspect, 1.0) * mix(0.56, 0.48, smoothstep(0.55, 1.4, aspect));
  gl_Position = vec4(relative.x / span.x, (relative.y - relative.z * 0.11) / span.y,
                     relative.z * 1.01 - 0.50, relative.z);
}

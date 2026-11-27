#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uHeight;
uniform vec4 uBounds;
uniform vec2 uResolution;
uniform vec3 uWeights;
uniform bool uSky;
in vec3 vPosition;
in vec3 vNormal;
out vec4 outColor;

float grain(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(grain(i), grain(i + vec2(1,0)), f.x),
             mix(grain(i + vec2(0,1)), grain(i + 1.0), f.x), f.y);
}

vec4 grain4(vec4 x, vec4 y, float z) {
  vec4 h = fract(x * .1031 + y * .11369 + z * .13787);
  h *= h + 19.19;
  return fract(h * (h + 7.17));
}

float volumeNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 x = i.x + vec4(0, 1, 0, 1);
  vec4 y = i.y + vec4(0, 0, 1, 1);
  vec4 a = mix(grain4(x, y, i.z), grain4(x, y, i.z + 1.0), f.z);
  return mix(mix(a.x, a.y, f.x), mix(a.z, a.w, f.x), f.y);
}

vec3 palette(vec3 day, vec3 sunset, vec3 night) {
  return day * uWeights.x + sunset * uWeights.y + night * uWeights.z;
}

vec3 reliefNormal(vec3 position, vec3 normal, float rockHeight, float snowHeight, float snow) {
  vec3 dx = dFdx(position), dy = dFdy(position);
  vec3 tx = cross(dy, normal), ty = cross(normal, dx);
  float area = dot(dx, tx);
  vec2 slope = mix(vec2(dFdx(rockHeight), dFdy(rockHeight)),
                   vec2(dFdx(snowHeight), dFdy(snowHeight)), snow);
  // Reconstruct world-space relief without displacing the mesh or its cast shadows.
  vec3 gradient = (tx * slope.x + ty * slope.y) * sign(area) / max(abs(area), 1e-7);
  return normalize(normal - gradient / max(1.0, length(gradient) / .66));
}

float visibility(vec3 position, vec3 sun) {
  float shade = 1.0;
  float distance = 0.12;
  ivec2 last = textureSize(uHeight, 0) - 1;
  for (int i = 0; i < 32; i++) {
    vec3 point = position + sun * distance;
    vec2 uv = (point.xz - uBounds.xy) / uBounds.zw;
    if (any(lessThan(uv, vec2(0))) || any(greaterThan(uv, vec2(1)))) break;
    vec2 cell = uv * vec2(last);
    ivec2 a = ivec2(cell);
    ivec2 b = min(a + 1, last);
    vec2 f = fract(cell);
    float h00 = texelFetch(uHeight, a, 0).r;
    float h10 = texelFetch(uHeight, ivec2(b.x, a.y), 0).r;
    float h01 = texelFetch(uHeight, ivec2(a.x, b.y), 0).r;
    float h11 = texelFetch(uHeight, b, 0).r;
    float ground = f.x + f.y <= 1.0
      ? h00 + f.x * (h10 - h00) + f.y * (h01 - h00)
      : h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
    float clearance = point.y + 0.055 - ground;
    shade = min(shade, smoothstep(-0.035, 0.065 + 0.012 * distance, clearance));
    if (shade < 0.001) break;
    distance += max(0.11, distance * 0.12);
  }
  return shade;
}

void main() {
  vec3 sun = normalize(palette(vec3(-0.84, 0.27, 0.40), vec3(0.76, 0.18, 0.53),
                               vec3(0.33, 0.62, -0.71)));
  vec3 haze = palette(vec3(.28,.40,.53), vec3(.43,.28,.29), vec3(.05,.085,.16));
  vec3 color;
  if (uSky) {
    vec2 uv = gl_FragCoord.xy / uResolution;
    color = mix(haze, palette(vec3(.035,.10,.23), vec3(.105,.09,.20), vec3(.014,.025,.064)),
                smoothstep(.32, 1.04, uv.y));
    float glow = exp(-5.0 * abs(uv.x - (.22 + .52 * uWeights.y))) * exp(-4.5 * abs(uv.y - .50));
    color += glow * palette(vec3(.14,.075,.025), vec3(.24,.08,.036), vec3(0));
  } else {
    vec3 p = vPosition;
    vec3 n = normalize(vNormal);
    // Sample in 3D so steep faces do not stretch a planar pattern downhill.
    vec3 material = mat3(.80, -.48, .36, .60, .64, -.48, 0.0, .60, .80) * p;
    float mottling = volumeNoise(material * 5.2 + vec3(13.0, 7.0, 19.0));
    float snowline = 1.25 + .59 * noise(p.xz * .58) + .32 * mottling;
    float snow = smoothstep(snowline, snowline + 1.21, p.y)
               * smoothstep(.27, .69, n.y + .22 * (mottling - .5));

    float blocks = volumeNoise(material * 3.4 + vec3(3.0, 17.0, 29.0));
    float chips = smoothstep(.40, .70, blocks);
    vec3 grainUV = material * 10.0;
    float grainFade = 1.0 - smoothstep(.32, .85, length(fwidth(grainUV)));
    float grit = (volumeNoise(grainUV) - .5) * grainFade;
    float rockHeight = .016 * chips + .009 * grit;
    float snowHeight = .004 * blocks + .003 * grit;
    vec3 detailNormal = reliefNormal(p, n, rockHeight, snowHeight, snow);
    vec3 rock = mix(vec3(.061,.064,.076), vec3(.225,.207,.176), .6 * mottling + .4 * blocks);
    rock *= .88 + .22 * chips + .27 * grit;
    vec3 snowColor = vec3(.82,.89,.99) * (.88 + .19 * blocks + .13 * grit);
    vec3 surface = mix(rock, snowColor, snow);

    float facing = dot(n, sun);
    float diffuse = max(0.0, dot(detailNormal, sun)) * smoothstep(-.03, .12, facing);
    float shade = facing > -.03 ? visibility(p, sun) : 0.0;
    float direct = diffuse * shade;
    direct *= mix(1.0 - .82 * uWeights.x, 1.0, smoothstep(1.2, 2.9, p.y));
    vec3 ambient = palette(vec3(.097,.202,.43), vec3(.15,.17,.34), vec3(.055,.095,.20));
    vec3 key = palette(vec3(2.85,1.67,.37), vec3(1.72,.59,.24), vec3(.28,.38,.56));
    vec3 toEye = vec3(-.25,1.1,-7.3) - p;
    vec3 halfVector = normalize(sun + normalize(toEye));
    float snowSheen = .055 * snow * shade * smoothstep(0.0, .15, facing)
      * pow(max(0.0, dot(detailNormal, halfVector)), 11.0);
    color = surface * (ambient * (.55 + .45 * detailNormal.y) + key * direct) + key * snowSheen;
    float distance = length(toEye);
    float mist = smoothstep(9.0, 29.0, distance) * (1.0 - smoothstep(-.3, 3.4, p.y));
    color = mix(color, haze * .58, mist * .56);
    float foreground = 1.0 - smoothstep(.8, 4.2, p.z);
    vec3 nearTone = palette(vec3(.032,.055,.095), vec3(.042,.041,.071), vec3(.016,.025,.044));
    color = mix(color, nearTone, .66 * foreground * (1.0 - smoothstep(.6, 1.4, p.y)));

    // Confine the extra aerial perspective to the low ground behind the foothills.
    float valley = smoothstep(2.0, 5.8, p.z) * (1.0 - smoothstep(.45, 2.2, p.y));
    vec3 valleyTone = palette(vec3(.15,.23,.35), vec3(.16,.145,.23), vec3(.051,.083,.156));
    color = mix(color, valleyTone, .38 * valley);
  }
  color = color / (1.0 + color);
  outColor = vec4(pow(color, vec3(1.0 / 2.2)), 1);
}

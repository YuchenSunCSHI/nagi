import { camera, waterPointAt } from './camera.js?v=1';

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
uniform vec4 uRipples[20];
uniform vec4 uRippleEnds[20];
uniform vec2 uRippleControls[20];
uniform int uRippleCount;
uniform vec4 uDrops[10];
uniform int uDropCount;
uniform vec2 uFishSeeds[6];
uniform vec4 uFishMotion[6];
uniform sampler2D uBedColor;
uniform sampler2D uBedNormal;
uniform sampler2D uFish;
uniform sampler2D uKoi;
uniform sampler2D uBass;
uniform sampler2D uCatfish;
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

void grassLayer(inout vec3 underwater, inout float grassDepth, inout float grassOpacity,
  vec2 surfacePoint, vec3 transmitted, float waterDepth, float antialias, vec2 root, float phase) {
  float distance = (root.y - surfacePoint.y) / max(transmitted.z, 0.05);
  float depth = distance * -transmitted.y;
  if (distance <= 0.0 || depth < 0.0 || depth >= waterDepth) return;
  float height = waterDepth - depth;
  if (height > 0.34) return;
  float x = surfacePoint.x + transmitted.x * distance - root.x;
  float opacity = 0.0;
  float colorWeight = 0.0;
  vec3 plantColor = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float blade = float(i);
    float length = 0.23 + 0.10 * randomValue(vec2(blade + phase, phase));
    float progress = clamp(height / length, 0.0, 1.0);
    float base = (blade - 2.5) * 0.03;
    float bend = ((blade - 2.5) * 0.02 + 0.045 * sin(uTime * 0.8 + phase + blade * 0.6))
      * progress * progress;
    float width = mix(0.012, 0.002, progress);
    float edge = 1.0 - smoothstep(width - antialias, width + antialias, abs(x - base - bend));
    float tip = 1.0 - smoothstep(length - antialias, length + antialias, height);
    float alpha = edge * tip * 0.88;
    vec3 color = mix(vec3(0.075, 0.19, 0.045), vec3(0.18, 0.32, 0.08), blade / 5.0);
    plantColor += color * alpha;
    colorWeight += alpha;
    opacity = max(opacity, alpha);
  }
  if (opacity <= 0.001) return;
  plantColor /= colorWeight;
  vec3 transmission = exp(-vec3(1.2, 0.35, 0.10) * distance);
  vec3 color = mix(vec3(0.025, 0.11, 0.24), plantColor, transmission);
  underwater = mix(underwater, color, opacity);
  if (depth < grassDepth) {
    grassDepth = depth;
    grassOpacity = opacity;
  }
}

vec3 fishLayer(sampler2D sprite, vec3 underwater, vec2 surfacePoint, vec3 transmitted, float waterDepth,
  float grassDepth, float grassOpacity,
  vec4 motion, vec2 seed, float fishDepth, float size) {
  vec2 position = motion.xy;
  vec2 heading = motion.zw;
  vec2 side = vec2(-heading.y, heading.x);
  float distance = fishDepth / max(-transmitted.y, 0.05);
  vec2 fishPoint = surfacePoint + transmitted.xz * distance;
  vec2 offset = fishPoint - position;
  vec2 uv = vec2(dot(offset, heading), dot(offset, side)) / size + 0.5;
  float tail = 1.0 - smoothstep(0.15, 0.65, uv.x);
  uv.y += sin(uTime * 4.0 - uv.x * 5.0 + seed.x) * 0.045 * tail;
  vec2 uvDx = dFdx(uv);
  vec2 uvDy = dFdy(uv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || fishDepth > waterDepth) {
    return underwater;
  }
  vec4 fish = textureGrad(sprite, uv, uvDx, uvDy);
  vec3 transmission = exp(-vec3(1.2, 0.35, 0.10) * distance);
  float luminance = dot(fish.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 fishAlbedo = max(vec3(luminance) + 1.5 * (fish.rgb - vec3(luminance)), 0.0);
  vec3 fishColor = mix(vec3(0.025, 0.11, 0.24), fishAlbedo * vec3(0.9, 0.95, 1.05), transmission);
  float visibility = grassDepth < fishDepth ? 1.0 - grassOpacity : 1.0;
  return mix(underwater, fishColor, fish.a * visibility);
}

void considerCurvePoint(vec2 origin, vec2 linear, vec2 curvature, vec2 point,
  float candidate, inout float position, inout float bestDistance) {
  float t = clamp(candidate, 0.0, 1.0);
  vec2 delta = origin + linear * t + curvature * t * t - point;
  float distanceSquared = dot(delta, delta);
  if (distanceSquared < bestDistance) {
    bestDistance = distanceSquared;
    position = t;
  }
}

const vec3 dayLight = vec3(-0.60, 0.36, 0.87);

vec3 clearDaySky(vec3 direction) {
  vec3 horizon = vec3(0.43, 0.72, 1.08);
  vec3 blue = vec3(0.060, 0.36, 1.0);
  float elevation = 1.0 - exp(-11.0 * max(direction.y, 0.0));
  float glow = pow(max(dot(direction, normalize(vec3(dayLight.x, 0.14, dayLight.z))), 0.0), 5.0);
  return mix(horizon, blue, elevation) + vec3(0.24, 0.23, 0.19) * glow;
}

void main() {
  vec2 screen = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
  float viewY = -${camera.pitch} + screen.y * ${camera.verticalScale};
  vec3 viewRay = normalize(vec3(screen.x * ${camera.horizontalScale}, viewY, 1.0));
  vec3 ray = normalize(vec3(screen.x * ${camera.horizontalScale}, min(viewY, -${camera.horizonMargin}), 1.0));
  vec2 point = ray.xz * (${camera.height} / -ray.y);

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
  float distantWaveDetail = 1.0 - 0.75 * uLighting.x * smoothstep(7.0, 20.0, point.y);
  float waveVisibility = (1.0 - smoothstep(0.7, 2.0, fwidth(wave))) * distantWaveDetail;
  gradient += cos(wave) * vec2(2.4 + 1.26 * cos(point.x * 1.8 + uTime * 0.35), 4.0)
    * 0.014 * waveVisibility;
  float crossWave = dot(point, vec2(-3.8, 2.2)) - uTime * 0.8;
  float crossVisibility = (1.0 - smoothstep(0.7, 2.0, fwidth(crossWave))) * distantWaveDetail;
  gradient += cos(crossWave) * vec2(-3.8, 2.2) * 0.010 * crossVisibility;

  const float rippleScale = 0.24;
  float worldPixel = length(fwidth(point));
  float rippleVisibility = 1.0 - smoothstep(0.15, 0.45, worldPixel / rippleScale);
  float surfaceHeight = 0.0;
  float nearestDistance = 1e10;
  vec2 nearestOffset = vec2(0.0);
  vec2 nearestDirection = vec2(0.0);
  float nearestAge = 0.0;
  float nearestStrength = 0.0;
  float nearestFade = 0.0;
  float nearestSlope = 0.0;
  for (int i = 0; i < 20; i++) {
    if (i >= uRippleCount) break;
    vec4 ripple = uRipples[i];
    vec4 end = uRippleEnds[i];
    vec2 control = uRippleControls[i];
    if (uTime - end.z >= 1.8 || uTime < ripple.z) continue;
    vec2 lower = min(min(ripple.xy, control), end.xy) - 0.4;
    vec2 upper = max(max(ripple.xy, control), end.xy) + 0.4;
    if (any(lessThan(point, lower)) || any(greaterThan(point, upper))) continue;
    vec2 linear = 2.0 * (control - ripple.xy);
    vec2 curvature = ripple.xy - 2.0 * control + end.xy;
    if (length(linear) + length(curvature) < 0.0001) continue;
    float position = 0.0;
    float bestDistance = dot(point - ripple.xy, point - ripple.xy);
    considerCurvePoint(ripple.xy, linear, curvature, point, 1.0, position, bestDistance);
    vec2 originOffset = ripple.xy - point;
    float cubic = 2.0 * dot(curvature, curvature);
    if (cubic < max(0.00000001, dot(linear, linear) * 0.005)) {
      float refined = clamp(-dot(originOffset, linear) / max(dot(linear, linear), 0.00000001), 0.0, 1.0);
      for (int j = 0; j < 4; j++) {
        vec2 delta = originOffset + linear * refined + curvature * refined * refined;
        vec2 tangent = linear + 2.0 * curvature * refined;
        float denominator = dot(tangent, tangent) + 2.0 * dot(delta, curvature);
        if (abs(denominator) < 0.00001) break;
        refined = clamp(refined - dot(delta, tangent) / denominator, 0.0, 1.0);
      }
      considerCurvePoint(ripple.xy, linear, curvature, point, refined, position, bestDistance);
    } else {
      float b = 3.0 * dot(linear, curvature) / cubic;
      float c = (dot(linear, linear) + 2.0 * dot(originOffset, curvature)) / cubic;
      float d = dot(originOffset, linear) / cubic;
      float p = c - b * b / 3.0;
      float q = 2.0 * b * b * b / 27.0 - b * c / 3.0 + d;
      float discriminant = q * q / 4.0 + p * p * p / 27.0;
      if (discriminant >= 0.0) {
        float root = sqrt(discriminant);
        float left = -q / 2.0 + root;
        float right = -q / 2.0 - root;
        float t = sign(left) * pow(abs(left), 1.0 / 3.0)
          + sign(right) * pow(abs(right), 1.0 / 3.0) - b / 3.0;
        considerCurvePoint(ripple.xy, linear, curvature, point, t, position, bestDistance);
      } else {
        float radius = 2.0 * sqrt(-p / 3.0);
        float angle = acos(clamp((-q / 2.0) / sqrt(-p * p * p / 27.0), -1.0, 1.0)) / 3.0;
        for (int j = 0; j < 3; j++) {
          float t = radius * cos(angle - float(j) * 2.0943951) - b / 3.0;
          considerCurvePoint(ripple.xy, linear, curvature, point, t, position, bestDistance);
        }
      }
    }
    vec2 closest = ripple.xy + linear * position + curvature * position * position;
    vec2 tangent = linear + 2.0 * curvature * position;
    if (length(tangent) < 0.0001) tangent = linear;
    if (length(tangent) < 0.0001) tangent = end.xy - ripple.xy;
    vec2 direction = tangent / max(length(tangent), 0.0001);
    float age = uTime - mix(ripple.z, end.z, position);
    if (age < 0.0 || age >= 1.8) continue;
    float width = (0.12 + age * 0.05) * rippleScale;
    float capWidth = width * 0.5;
    bool first = mod(end.w, 2.0) > 0.5;
    bool last = end.w >= 2.0;

    float pathFade = 1.0;
    float pathSlope = 0.0;
    float startAlong = dot(point - ripple.xy, direction);
    float endAlong = dot(point - end.xy, direction);
    if (first && position < 0.0001 && startAlong < 0.0) {
      if (startAlong < -capWidth) continue;
      float along = startAlong;
      float start = clamp((along + capWidth) / capWidth, 0.0, 1.0);
      pathFade = start * start * (3.0 - 2.0 * start);
      pathSlope = 6.0 * start * (1.0 - start) / capWidth;
      closest = ripple.xy + direction * along;
    } else if (last && position > 0.9999 && endAlong > 0.0) {
      if (endAlong > capWidth) continue;
      float finish = clamp(endAlong / capWidth, 0.0, 1.0);
      pathFade = 1.0 - finish * finish * (3.0 - 2.0 * finish);
      pathSlope = -6.0 * finish * (1.0 - finish) / capWidth;
      closest = end.xy + direction * endAlong;
    }

    vec2 offset = point - closest;
    float distance = length(offset);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestOffset = offset;
      nearestDirection = direction;
      nearestAge = age;
      nearestStrength = ripple.w;
      nearestFade = pathFade;
      nearestSlope = pathSlope;
    }
  }
  if (nearestDistance < 1e9) {
    float width = (0.12 + nearestAge * 0.05) * rippleScale;
    float ring = nearestDistance - nearestAge * 0.56 * rippleScale;
    float fade = smoothstep(0.0, 0.15, nearestAge) * (1.0 - smoothstep(1.1, 1.8, nearestAge));
    if (nearestDistance < width * 2.5) {
      float depressionHeight = -0.01 * fade
        * exp(-2.0 * nearestDistance * nearestDistance / (width * width)) * rippleVisibility;
      float depression = depressionHeight * nearestFade;
      surfaceHeight += depression;
      gradient -= 4.0 * depression * nearestOffset / (width * width);
      gradient += depressionHeight * nearestSlope * nearestDirection;
    }
    if (abs(ring) < width * 2.5) {
      float envelope = exp(-1.7 * ring * ring / (width * width));
      float phase = ring * 17.0 / rippleScale;
      float slope = nearestStrength * rippleScale * fade * envelope
        * (17.0 / rippleScale * cos(phase) - 3.4 * ring / (width * width) * sin(phase));
      float rippleHeight = nearestStrength * rippleScale * fade * envelope * sin(phase);
      gradient += (nearestOffset / max(nearestDistance, 0.001 * rippleScale) * slope * nearestFade
        + rippleHeight * nearestSlope * nearestDirection) * rippleVisibility;
    }
  }
  for (int i = 0; i < 10; i++) {
    if (i >= uDropCount) break;
    vec4 drop = uDrops[i];
    float age = uTime - drop.z;
    if (age < 0.0 || age >= 1.8) continue;
    vec2 offset = point - drop.xy;
    float distance = length(offset);
    float width = (0.12 + age * 0.05) * rippleScale;
    float ring = distance - age * 0.56 * rippleScale;
    if (abs(ring) < width * 2.5) {
      float fade = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(1.1, 1.8, age));
      float envelope = exp(-1.7 * ring * ring / (width * width));
      float phase = ring * 17.0 / rippleScale;
      float slope = drop.w * rippleScale * fade * envelope
        * (17.0 / rippleScale * cos(phase) - 3.4 * ring / (width * width) * sin(phase));
      gradient += offset / max(distance, 0.001 * rippleScale) * slope * rippleVisibility;
    }
  }
  // Fade out unresolved wave slopes before the horizon ray clamp repeats a row.
  gradient *= 1.0 - uLighting.x * smoothstep(25.0, 55.0, point.y);
  vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
  vec3 reflected = reflect(ray, normal);
  vec3 lightDirection = normalize(
    dayLight * uLighting.x
    + vec3(0.11, 0.29, 0.95) * uLighting.y
    + vec3(0.08, 0.35, 0.93) * uLighting.z
  );

  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-ray, normal), 0.0), 5.0);
  // Use the unclamped view slope so the transition can continue all the way to the horizon.
  float deepWater = 1.0 - smoothstep(0.0, 0.18, -viewY);
  float skyMix = smoothstep(-0.2, 0.9, reflected.y);
  vec3 sunsetSky = mix(vec3(0.90, 0.40, 0.16), vec3(1.15, 0.68, 0.29), skyMix);
  vec3 nightSky = mix(vec3(0.025, 0.045, 0.10), vec3(0.08, 0.13, 0.23), skyMix);
  vec3 dayReflection = clearDaySky(reflected)
    * mix(vec3(1.0), vec3(0.30, 0.42, 0.52), deepWater);
  vec3 sky = dayReflection * uLighting.x
    + sunsetSky * uLighting.y + nightSky * uLighting.z;

  vec3 refractionNormal = normalize(vec3(-gradient.x * 0.65, 1.0, -gradient.y * 0.65));
  vec3 transmitted = refract(ray, refractionNormal, 1.0 / 1.333);
  float depth = max(0.05, mix(0.3, 0.6, noiseWithGradient(point * 0.7).x) + surfaceHeight);
  float waterDistance = depth / max(-transmitted.y, 0.05);
  vec2 surfacePoint = point + ray.xz * (-surfaceHeight / -ray.y);
  vec2 bottomPoint = surfacePoint + transmitted.xz * waterDistance;
  vec3 bottom = riverbed(bottomPoint);
  bottom *= 0.92 + 0.16 * noiseWithGradient(bottomPoint * 3.0 + vec2(uTime * 0.2, -uTime * 0.1)).x;
  vec3 transmission = exp(-vec3(1.2, 0.35, 0.10) * waterDistance);
  vec3 waterTint = mix(vec3(0.025, 0.11, 0.24), vec3(0.018, 0.16, 0.22), uLighting.x);
  float dayDepth = deepWater * uLighting.x;
  waterTint = mix(waterTint, vec3(0.025, 0.085, 0.14), dayDepth);
  transmission *= 1.0 - dayDepth;
  vec3 underwater = mix(waterTint, bottom * vec3(0.58, 0.73, 1.02), transmission);
  float grassDepth = 1e5;
  float grassOpacity = 0.0;
  float grassAntialias = clamp(worldPixel * 0.75, 0.001, 0.015);
  grassLayer(underwater, grassDepth, grassOpacity, surfacePoint, transmitted, depth,
    grassAntialias, vec2(-0.95, 3.8), 3.4);
  grassLayer(underwater, grassDepth, grassOpacity, surfacePoint, transmitted, depth,
    grassAntialias, vec2(1.05, 2.8), 1.7);
  grassLayer(underwater, grassDepth, grassOpacity, surfacePoint, transmitted, depth,
    grassAntialias, vec2(-1.0, 2.4), 0.2);
  underwater = fishLayer(uCatfish, underwater, surfacePoint, transmitted, depth, grassDepth, grassOpacity,
    uFishMotion[0], uFishSeeds[0], 0.22, 0.70);
  underwater = fishLayer(uFish, underwater, surfacePoint, transmitted, depth, grassDepth, grassOpacity,
    uFishMotion[1], uFishSeeds[1], 0.20, 0.62);
  underwater = fishLayer(uBass, underwater, surfacePoint, transmitted, depth, grassDepth, grassOpacity,
    uFishMotion[2], uFishSeeds[2], 0.17, 0.66);
  underwater = fishLayer(uFish, underwater, surfacePoint, transmitted, depth, grassDepth, grassOpacity,
    uFishMotion[3], uFishSeeds[3], 0.14, 0.68);
  underwater = fishLayer(uKoi, underwater, surfacePoint, transmitted, depth, grassDepth, grassOpacity,
    uFishMotion[4], uFishSeeds[4], 0.11, 0.72);
  underwater = fishLayer(uFish, underwater, surfacePoint, transmitted, depth, grassDepth, grassOpacity,
    uFishMotion[5], uFishSeeds[5], 0.09, 0.75);
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
  float glintStrength = dot(vec3(0.62, 4.5, 0.65), uLighting);
  float glowStrength = dot(vec3(0.06, 0.27, 0.035), uLighting);
  color += lightColor * (glint * glintStrength + glow * glowStrength);

  vec3 horizonSky = vec3(1.05, 0.55, 0.25) * uLighting.y
    + vec3(0.055, 0.09, 0.16) * uLighting.z;
  vec3 upperSky = vec3(0.65, 0.35, 0.44) * uLighting.y
    + vec3(0.025, 0.045, 0.10) * uLighting.z;
  float skySideLight = smoothstep(-0.55, 0.60, -viewRay.x);
  float skyElevation = 1.0 - exp(-22.0 * max(viewRay.y, 0.0));
  vec3 dayHorizonSky = mix(vec3(0.36, 0.67, 1.04), vec3(0.74, 1.13, 1.54), skySideLight);
  vec3 dayUpperSky = mix(vec3(0.025, 0.25, 1.32), vec3(0.15, 0.48, 1.28), skySideLight);
  vec3 visibleSky = mix(horizonSky, upperSky, smoothstep(0.0, 0.35, viewRay.y))
    + mix(dayHorizonSky, dayUpperSky, skyElevation) * uLighting.x;
  float haze = smoothstep(12.0, 45.0, point.y);
  color = color * (1.0 - haze * (1.0 - uLighting.x))
    + horizonSky * vec3(0.82, 0.87, 0.91) * haze;
  // Soften only the last few pixels of water without flattening the distant water into haze.
  float horizonEdge = max(fwidth(viewY), 0.001);
  float horizonVeil = smoothstep(-6.0 * horizonEdge, 0.0, viewY);
  color = mix(color, dayHorizonSky, 0.16 * horizonVeil * uLighting.x);
  horizonEdge *= 1.0 + 0.75 * uLighting.x;
  color = mix(color, visibleSky, smoothstep(-horizonEdge, horizonEdge, viewY));

  color = color / (1.0 + color);
  color = pow(color, vec3(1.0 / 2.2));
  outColor = vec4(color, 1.0);
}`;

let gl;
let program;
let resolutionLocation;
let timeLocation;
let lightingLocation;
let rippleLocation;
let rippleEndLocation;
let rippleControlLocation;
let rippleCountLocation;
let dropLocation;
let dropCountLocation;
let fishMotionLocation;
const ripples = [];
const drops = [];
const rippleUniforms = new Float32Array(20 * 4);
const rippleEndUniforms = new Float32Array(20 * 4);
const rippleControlUniforms = new Float32Array(20 * 2);
const dropUniforms = new Float32Array(10 * 4);
const fishSeeds = Float32Array.from({ length: 6 * 2 }, () => Math.random() * Math.PI * 2);
const fishMotionUniforms = new Float32Array(6 * 4);
const fish = [
  [-0.9, 3.95, 1.35, 0.38, 0.07, 0.22],
  [1.0, 4.2, 1.9, 0.38, 0.065, 0.20],
  [0.9, 3.55, 1.2, 0.35, 0.073, 0.17],
  [0.2, 3.4, 1.55, 0.35, 0.075, 0.14],
  [-0.4, 3.05, 1.35, 0.27, 0.085, 0.11],
  [-0.7, 2.6, 1.45, 0.35, 0.08, 0.09]
].map(([x, z, radiusX, radiusZ, speed, depth], index) => ({
  x, z, radiusX, radiusZ, speed, depth,
  seed: fishSeeds[index * 2], driftSeed: fishSeeds[index * 2 + 1],
  offsetX: 0, offsetZ: 0, velocityX: 0, velocityZ: 0,
  updated: 0, heading: undefined, headingTime: 0, lastStartle: -Infinity
}));
let lastPointer;
let pointerPoint;
let gesture;
let gestureTimer;
let activeStroke;
let previousStroke;
let strokeAnchor;
let strokeDirection;
let currentPath;
let lastRippleTime = 0;
let frame = 0;
let startTime = 0;
let elapsed = 0;
let quality = 1;
let sampleStart = 0;
let sampleFrames = 0;
let contextLost = false;
let bedColorImage;
let bedNormalImage;
let fishImage;
let koiImage;
let bassImage;
let catfishImage;
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

function bindTexture(image, unit, uniformName, isColor, repeat = true) {
  const texture = gl.createTexture();
  if (!texture) throw new Error(`Unable to create ${uniformName} texture`);
  const location = gl.getUniformLocation(program, uniformName);
  if (location === null) throw new Error(`Missing ${uniformName} uniform`);
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, isColor ? gl.SRGB8_ALPHA8 : gl.RGBA,
    gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
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
    rippleLocation = gl.getUniformLocation(program, 'uRipples[0]');
    rippleEndLocation = gl.getUniformLocation(program, 'uRippleEnds[0]');
    rippleControlLocation = gl.getUniformLocation(program, 'uRippleControls[0]');
    rippleCountLocation = gl.getUniformLocation(program, 'uRippleCount');
    dropLocation = gl.getUniformLocation(program, 'uDrops[0]');
    dropCountLocation = gl.getUniformLocation(program, 'uDropCount');
    const fishSeedsLocation = gl.getUniformLocation(program, 'uFishSeeds[0]');
    fishMotionLocation = gl.getUniformLocation(program, 'uFishMotion[0]');
    if (resolutionLocation === null || timeLocation === null || lightingLocation === null
      || rippleLocation === null || rippleEndLocation === null || rippleCountLocation === null
      || rippleControlLocation === null || dropLocation === null || dropCountLocation === null
      || fishSeedsLocation === null || fishMotionLocation === null) {
      throw new Error('Required shader uniforms are missing');
    }
    gl.useProgram(program);
    gl.uniform2fv(fishSeedsLocation, fishSeeds);
    bindTexture(bedColorImage, 0, 'uBedColor', true);
    bindTexture(bedNormalImage, 1, 'uBedNormal', false);
    bindTexture(fishImage, 2, 'uFish', true, false);
    bindTexture(koiImage, 3, 'uKoi', true, false);
    bindTexture(bassImage, 4, 'uBass', true, false);
    bindTexture(catfishImage, 5, 'uCatfish', true, false);
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

function fishPosition(fish, time) {
  const driftSpeed = 0.026 + 0.008 * Math.sin(fish.driftSeed);
  const depthSpeed = 0.021 + 0.006 * Math.cos(fish.seed);
  const angle = time * fish.speed + fish.seed
    + 0.35 * (Math.sin(time * 0.035 + fish.driftSeed) - Math.sin(fish.driftSeed));
  const angularSpeed = fish.speed + 0.01225 * Math.cos(time * 0.035 + fish.driftSeed);
  return {
    x: fish.x + fish.radiusX * Math.cos(angle)
      + 0.15 * Math.sin(time * driftSpeed + fish.driftSeed) + fish.offsetX,
    z: fish.z + fish.radiusZ * Math.sin(angle)
      + 0.07 * Math.sin(time * depthSpeed + fish.seed) + fish.offsetZ,
    velocityX: -fish.radiusX * Math.sin(angle) * angularSpeed
      + 0.15 * driftSpeed * Math.cos(time * driftSpeed + fish.driftSeed)
      + fish.velocityX,
    velocityZ: fish.radiusZ * Math.cos(angle) * angularSpeed
      + 0.07 * depthSpeed * Math.cos(time * depthSpeed + fish.seed)
      + fish.velocityZ
  };
}

function advanceFish(fish, time) {
  const dt = Math.max(0, time - fish.updated);
  const slowdown = 1.2;
  const speedDecay = Math.exp(-slowdown * dt);
  const distance = (1 - speedDecay) / slowdown;
  fish.offsetX += fish.velocityX * distance;
  fish.offsetZ += fish.velocityZ * distance;
  fish.velocityX *= speedDecay;
  fish.velocityZ *= speedDecay;
  fish.updated = Math.max(fish.updated, time);
}

function updateFish(time) {
  for (let i = 0; i < fish.length; i++) {
    const current = fish[i];
    advanceFish(current, time);
    const position = fishPosition(current, time);
    const target = Math.atan2(position.velocityZ, position.velocityX);
    if (current.heading === undefined) current.heading = target;
    const turn = Math.atan2(Math.sin(target - current.heading), Math.cos(target - current.heading));
    const maxTurn = 4 * Math.max(0, time - current.headingTime);
    current.heading += Math.max(-maxTurn, Math.min(maxTurn, turn));
    current.headingTime = Math.max(current.headingTime, time);
    fishMotionUniforms.set([position.x, position.z, Math.cos(current.heading), Math.sin(current.heading)], i * 4);
  }
  gl.uniform4fv(fishMotionLocation, fishMotionUniforms);
}

function draw(time) {
  while (ripples.length && time - ripples[0].endTime >= 1.8) ripples.shift();
  while (drops.length && time - drops[0].time >= 1.8) drops.shift();
  for (let i = 0; i < ripples.length; i++) {
    const ripple = ripples[i];
    const first = i === 0 || ripples[i - 1].path !== ripple.path;
    const last = i === ripples.length - 1 || ripples[i + 1].path !== ripple.path;
    rippleUniforms.set([ripple.x, ripple.z, ripple.time, ripple.strength], i * 4);
    rippleEndUniforms.set([ripple.endX, ripple.endZ, ripple.endTime, Number(first) + 2 * Number(last)], i * 4);
    rippleControlUniforms.set([ripple.controlX, ripple.controlZ], i * 2);
  }
  for (let i = 0; i < drops.length; i++) {
    const drop = drops[i];
    dropUniforms.set([drop.x, drop.z, drop.time, drop.strength], i * 4);
  }
  gl.uniform1f(timeLocation, time);
  gl.uniform3fv(lightingLocation, currentLighting(performance.now()));
  gl.uniform1i(rippleCountLocation, ripples.length);
  if (ripples.length) {
    gl.uniform4fv(rippleLocation, rippleUniforms);
    gl.uniform4fv(rippleEndLocation, rippleEndUniforms);
    gl.uniform2fv(rippleControlLocation, rippleControlUniforms);
  }
  gl.uniform1i(dropCountLocation, drops.length);
  if (drops.length) gl.uniform4fv(dropLocation, dropUniforms);
  updateFish(time);
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
  resetGesture();
  pointerPoint = undefined;
  if (!gl || contextLost || !message.hidden || document.hidden) return;
  resize();
  if (motionPreference.matches) {
    draw(elapsed);
  } else {
    frame = requestAnimationFrame(tick);
  }
}

function pointerPosition(event) {
  const point = waterPointAt(canvas, event.clientX, event.clientY);
  if (!point) return undefined;
  const now = performance.now();
  const time = elapsed + (startTime ? (now - startTime) / 1000 : 0);
  return { ...point, time, now, clientX: event.clientX, clientY: event.clientY };
}

function resetGesture() {
  clearTimeout(gestureTimer);
  gesture = undefined;
  lastPointer = undefined;
  activeStroke = undefined;
  previousStroke = undefined;
  strokeAnchor = undefined;
  strokeDirection = undefined;
  currentPath = undefined;
}

function pointAtFishDepth(point, depth) {
  const horizontal = point.x * point.x + point.z * point.z;
  const refractiveIndex = 1.333;
  const factor = 1 + depth / (refractiveIndex
    * Math.sqrt(camera.height * camera.height + horizontal * (1 - 1 / (refractiveIndex * refractiveIndex))));
  return { x: point.x * factor, z: point.z * factor };
}

function startleFish(from, to, strength, time) {
  for (const current of fish) {
    advanceFish(current, time);
    if (time - current.lastStartle < 0.14) continue;
    const position = fishPosition(current, time);
    const a = pointAtFishDepth(from, current.depth);
    const b = pointAtFishDepth(to, current.depth);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const along = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.z - a.z) * dz) / lengthSquared))
      : 0;
    const awayX = position.x - a.x - along * dx;
    const awayZ = position.z - a.z - along * dz;
    const distance = Math.hypot(awayX, awayZ);
    const radius = 0.7;
    if (distance >= radius) continue;
    const influence = 1 - distance / radius;
    const falloff = influence * influence * (3 - 2 * influence);
    const angle = Math.atan2(position.velocityZ, position.velocityX)
      + (Math.random() - 0.5) * Math.PI / 3;
    const impulse = Math.min(strength * falloff * (0.8 + Math.random() * 0.4),
      Math.max(0, 0.9 - Math.hypot(current.velocityX, current.velocityZ)));
    current.velocityX += Math.cos(angle) * impulse;
    current.velocityZ += Math.sin(angle) * impulse;
    current.lastStartle = time;
  }
}

function finishGesture() {
  if (gesture && !gesture.isStroke && gesture.distance > 0) {
    const now = performance.now();
    const time = elapsed + (startTime ? (now - startTime) / 1000 : 0);
    drops.push({ x: pointerPoint.x, z: pointerPoint.z, time, strength: 0.014 });
    if (drops.length > 10) drops.shift();
    startleFish(pointerPoint, pointerPoint, 0.24, time);
  }
  resetGesture();
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, time: (a.time + b.time) / 2 };
}

function setStrokeEnd(stroke, point) {
  stroke.endX = point.x;
  stroke.endZ = point.z;
  stroke.endTime = point.time;
}

function appendStroke(point) {
  const dx = point.x - lastPointer.x;
  const dz = point.z - lastPointer.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.015) return;
  const direction = { x: dx / distance, z: dz / distance };
  const turning = strokeDirection
    && direction.x * strokeDirection.x + direction.z * strokeDirection.z < 0.75;
  if (!activeStroke) {
    const control = midpoint(lastPointer, point);
    activeStroke = {
      x: lastPointer.x, z: lastPointer.z, time: Math.max(lastPointer.time, point.time - 1.8),
      controlX: control.x, controlZ: control.z, endX: point.x, endZ: point.z,
      endTime: point.time, strength: 0.014, path: currentPath
    };
    ripples.push(activeStroke);
    if (ripples.length > 20) ripples.shift();
    lastRippleTime = point.now;
  } else if (point.now - lastRippleTime >= 90 || (turning && point.now - lastRippleTime >= 20)) {
    const join = midpoint(lastPointer, point);
    activeStroke.controlX = lastPointer.x;
    activeStroke.controlZ = lastPointer.z;
    setStrokeEnd(activeStroke, join);
    previousStroke = activeStroke;
    strokeAnchor = lastPointer;
    const control = midpoint(join, point);
    activeStroke = {
      x: join.x, z: join.z, time: join.time, controlX: control.x, controlZ: control.z,
      endX: point.x, endZ: point.z, endTime: point.time, strength: 0.014, path: currentPath
    };
    ripples.push(activeStroke);
    if (ripples.length > 20) ripples.shift();
    lastRippleTime = point.now;
  } else {
    if (previousStroke) {
      const join = midpoint(strokeAnchor, point);
      setStrokeEnd(previousStroke, join);
      activeStroke.x = join.x;
      activeStroke.z = join.z;
      activeStroke.time = join.time;
    }
    const control = midpoint(activeStroke, point);
    activeStroke.controlX = control.x;
    activeStroke.controlZ = control.z;
    setStrokeEnd(activeStroke, point);
  }
  strokeDirection = direction;
  lastPointer = point;
}

canvas.addEventListener('pointerenter', (event) => {
  if (event.pointerType === 'mouse') pointerPoint = pointerPosition(event);
});
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || motionPreference.matches || !gl || contextLost
    || !message.hidden || document.hidden) return;
  const point = pointerPosition(event);
  if (!point) {
    finishGesture();
    pointerPoint = undefined;
    return;
  }
  if (!pointerPoint) {
    pointerPoint = point;
    return;
  }
  if (gesture && point.now - gesture.lastTime >= 220) finishGesture();
  const previousPoint = pointerPoint;
  const distance = Math.hypot(point.clientX - pointerPoint.clientX, point.clientY - pointerPoint.clientY);
  if (distance === 0) return;
  if (!gesture) {
    gesture = { distance: 0, lastTime: point.now, isStroke: false, points: [pointerPoint] };
    lastPointer = pointerPoint;
    currentPath = {};
  }
  gesture.distance += distance;
  gesture.lastTime = point.now;
  pointerPoint = point;
  clearTimeout(gestureTimer);
  gestureTimer = setTimeout(finishGesture, 220);
  if (gesture.isStroke) {
    appendStroke(point);
    startleFish(previousPoint, point, 0.6, point.time);
  } else if (gesture.distance > 15) {
    gesture.isStroke = true;
    for (const previous of gesture.points.slice(1)) appendStroke(previous);
    appendStroke(point);
    const points = [...gesture.points, point];
    for (let i = 1; i < points.length; i++) startleFish(points[i - 1], points[i], 0.6, point.time);
    gesture.points = [];
  } else {
    const previous = gesture.points[gesture.points.length - 1];
    if (Math.hypot(point.clientX - previous.clientX, point.clientY - previous.clientY) >= 2) {
      gesture.points.push(point);
    }
  }
});
canvas.addEventListener('pointerleave', (event) => {
  if (event.pointerType !== 'mouse') return;
  finishGesture();
  pointerPoint = undefined;
});
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  stop();
  resetGesture();
  pointerPoint = undefined;
  showError('图形渲染暂时中断，正在等待浏览器恢复。');
});
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  if (initialize()) updatePlayback();
});
window.addEventListener('resize', updatePlayback);
document.addEventListener('visibilitychange', updatePlayback);
motionPreference.addEventListener('change', () => {
  if (motionPreference.matches) {
    lightingFrom = lightingModes[lightingIndex].weights;
    ripples.length = 0;
    drops.length = 0;
  }
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

message.textContent = '正在加载水下素材…';
message.hidden = false;
Promise.all([
  loadImage('assets/dry_river_pebbles_diff_1k.jpg'),
  loadImage('assets/dry_river_pebbles_nor_gl_1k.jpg'),
  loadImage('assets/fish-trout.png'),
  loadImage('assets/fish-koi.png'),
  loadImage('assets/fish-largemouth-bass.png'),
  loadImage('assets/fish-channel-catfish.png')
]).then(([color, normal, fish, koi, bass, catfish]) => {
  bedColorImage = color;
  bedNormalImage = normal;
  fishImage = fish;
  koiImage = koi;
  bassImage = bass;
  catfishImage = catfish;
  if (initialize()) updatePlayback();
}, (error) => {
  showError('水下素材加载失败，请检查资源文件和浏览器控制台。', error);
});

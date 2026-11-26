#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uCameraPitch;
uniform vec4 uCameraShape;
uniform vec4 uAppearance; // Day-sky blue, far-water transition width, reflection strength, and day sparkle boost.
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
  float viewY = -uCameraPitch + screen.y * uCameraShape.y;
  vec3 viewRay = normalize(vec3(screen.x * uCameraShape.x, viewY, 1.0));
  vec3 ray = normalize(vec3(screen.x * uCameraShape.x, min(viewY, -uCameraShape.z), 1.0));
  vec2 point = ray.xz * (uCameraShape.w / -ray.y);

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
  float deepWater = 1.0 - smoothstep(0.0, 0.18 * uAppearance.y, -viewY);
  float skyMix = smoothstep(-0.2, 0.9, reflected.y);
  vec3 sunsetSky = mix(vec3(0.90, 0.40, 0.16), vec3(1.15, 0.68, 0.29), skyMix);
  vec3 nightSky = mix(vec3(0.025, 0.045, 0.10), vec3(0.08, 0.13, 0.23), skyMix);
  vec3 dayReflection = clearDaySky(reflected)
    * mix(vec3(1.0 + 0.22 * uAppearance.w), vec3(0.30, 0.42, 0.52), deepWater);
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
  vec3 color = mix(underwater, sky, min(1.0, fresnel * uAppearance.z));

  float sunAlignment = max(dot(reflected, lightDirection), 0.0);
  float glint = pow(sunAlignment, mix(110.0, 80.0, uLighting.y));
  float glow = pow(sunAlignment, 18.0);
  vec3 lightColor = vec3(1.0, 0.84, 0.61) * uLighting.x
    + vec3(1.0, 0.67, 0.24) * uLighting.y
    + vec3(0.72, 0.82, 1.0) * uLighting.z;
  float glintStrength = dot(vec3(0.62, 4.5, 0.65), uLighting);
  float glowStrength = dot(vec3(0.06, 0.27, 0.035), uLighting);
  // A narrow sun glint adds bright crests without lifting the whole water surface.
  float daySparkle = uLighting.x * (1.0 - smoothstep(12.0, 32.0, point.y))
    * (0.85 * glint + 2.4 * pow(sunAlignment, 280.0)) * uAppearance.w;
  color += (lightColor * (glint * glintStrength + glow * glowStrength)
    + vec3(1.0, 0.94, 0.83) * daySparkle) * uAppearance.z;

  vec3 horizonSky = vec3(1.05, 0.55, 0.25) * uLighting.y
    + vec3(0.055, 0.09, 0.16) * uLighting.z;
  vec3 upperSky = vec3(0.65, 0.35, 0.44) * uLighting.y
    + vec3(0.025, 0.045, 0.10) * uLighting.z;
  float skySideLight = smoothstep(-0.55, 0.60, -viewRay.x);
  float skyElevation = 1.0 - exp(-22.0 * max(viewRay.y, 0.0));
  vec3 dayHorizonSky = mix(vec3(0.36, 0.67, 1.04), vec3(0.74, 1.13, 1.54), skySideLight);
  vec3 dayUpperSky = mix(vec3(0.025, 0.25, 1.32), vec3(0.15, 0.48, 1.28), skySideLight);
  dayHorizonSky.b *= uAppearance.x;
  dayUpperSky.b *= uAppearance.x;
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
}

export const terrainSize = 321;
export const terrainBounds = [-10, -5.4, 20, 24.4] as const;

const mainSummit = [-0.6, 6.8, 5.1, 3.2, 3.5] as const;

function smoothstep(low: number, high: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

function summitRelief(x: number, z: number, radius: number) {
  const angle = Math.atan2(z, x);
  // Bend the downhill spurs and give adjacent gullies unequal widths and depths.
  const bearing = angle + .13 * radius * Math.sin(2 * angle + 1.4)
    + .14 * Math.sin(2 * angle - .7);
  const folds = .48 * Math.cos(5 * bearing + .8) + .32 * Math.sin(3 * bearing - .5)
    + .20 * Math.cos(8 * bearing - radius * .85);
  const profile = .64 * Math.max(folds, 0) - .92 * Math.max(-folds, 0) ** 1.25;
  return profile * smoothstep(.16, 1.25, radius) * (1 - smoothstep(2.6, 4.5, radius));
}

function noise(x: number, z: number) {
  const hash = (a: number, b: number) => {
    let n = Math.imul(a, 0x1f123bb5) ^ Math.imul(b, 0x5f356495);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
  };
  const a = Math.floor(x), b = Math.floor(z);
  const curve = (t: number) => t * t * (3 - 2 * t);
  const u = curve(x - a), v = curve(z - b);
  const low = hash(a, b) * (1 - u) + hash(a + 1, b) * u;
  const high = hash(a, b + 1) * (1 - u) + hash(a + 1, b + 1) * u;
  return low * (1 - v) + high * v;
}

export function buildTerrain() {
  const peaks = [
    mainSummit, [-3.7, 7.3, 3.65, 3, 4.2],
    [2.25, 7.8, 4.0, 3.4, 3.9], [4.8, 10.2, 3.3, 4, 4.5],
    [-6.3, 10.5, 3.3, 3.8, 4.2], [1.4, 11, 3.6, 4.8, 4.1],
    [-4.1, 3.0, 1.02, 4.8, 4.4], [4.1, 2.1, .86, 4.6, 4.3]
  ];
  const heights = new Float32Array(terrainSize ** 2);
  const indices = new Uint32Array((terrainSize - 1) ** 2 * 6);
  for (let j = 0, cursor = 0; j < terrainSize; j++) {
    for (let i = 0; i < terrainSize; i++) {
      const index = j * terrainSize + i;
      const x = terrainBounds[0] + i / (terrainSize - 1) * terrainBounds[2];
      const z = terrainBounds[1] + j / (terrainSize - 1) * terrainBounds[3];
      const wx = x + 0.8 * (noise(x * .72 + 19, z * .7) - .5);
      const wz = z + 0.85 * (noise(x * .6, z * .66 + 31) - .5);
      const summitX = wx - mainSummit[0], summitZ = wz - mainSummit[1];
      const summitDistance = Math.hypot(summitX, summitZ);
      let base = 0;
      let mainHeight = 0;
      for (const peak of peaks) {
        const [px, pz, elevation, width, depth] = peak;
        const dx = (wx - px) / width, dz = (wz - pz) / depth;
        const shoulder = Math.hypot(dx + .32 * dz, dz);
        const shape = Math.max(0, 1 - .65 * shoulder) ** 1.32;
        const height = elevation * shape;
        if (peak === mainSummit) mainHeight = height;
        else base = Math.max(base, height);
      }
      const summitInfluence = smoothstep(0, .65, mainHeight - base)
        * (1 - smoothstep(2.6, 4.5, summitDistance));
      base = Math.max(base, mainHeight + summitRelief(summitX, summitZ, summitDistance));
      let relief = 0;
      for (let octave = 0, f = .9, a = .39; octave < 6; octave++, f *= 1.99, a *= .48) {
        const stretched = noise(wx * f + octave * 17, wz * f * .68);
        const fractured = summitInfluence > 0 ? noise((wx + .4 * wz) * f + octave * 17, (wz - .4 * wx) * f) : stretched;
        const detail = stretched + (fractured - stretched) * summitInfluence;
        const ridge = 1 - Math.abs(2 * detail - 1);
        relief += (ridge * ridge - .4) * a;
      }
      const foothillDetail = .42 + .58 * smoothstep(.5, 4.8, z);
      heights[index] = base + relief * Math.min(1, base * .8) * foothillDetail - .23;
      if (i < terrainSize - 1 && j < terrainSize - 1) {
        indices[cursor++] = index;
        indices[cursor++] = index + terrainSize;
        indices[cursor++] = index + 1;
        indices[cursor++] = index + 1;
        indices[cursor++] = index + terrainSize;
        indices[cursor++] = index + terrainSize + 1;
      }
    }
  }
  return { heights, indices };
}

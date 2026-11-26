import { camera, type WaterPoint } from './camera';

export function createFishSchool() {
  const seeds = Float32Array.from({ length: 6 * 2 }, () => Math.random() * Math.PI * 2);
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
    seed: seeds[index * 2], driftSeed: seeds[index * 2 + 1],
    offsetX: 0, offsetZ: 0, velocityX: 0, velocityZ: 0,
    updated: 0, heading: undefined as number | undefined, headingTime: 0, lastStartle: -Infinity
  }));
  type Fish = typeof fish[number];

  function fishPosition(fish: Fish, time: number) {
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

  function advanceFish(fish: Fish, time: number) {
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

  function updateFish(time: number) {
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
    return fishMotionUniforms;
  }

  function pointAtFishDepth(point: WaterPoint, depth: number) {
    const horizontal = point.x * point.x + point.z * point.z;
    const refractiveIndex = 1.333;
    const factor = 1 + depth / (refractiveIndex
      * Math.sqrt(camera.height * camera.height + horizontal * (1 - 1 / (refractiveIndex * refractiveIndex))));
    return { x: point.x * factor, z: point.z * factor };
  }

  function startleFish(from: WaterPoint, to: WaterPoint, strength: number, time: number) {
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

  return { seeds, update: updateFish, startle: startleFish };
}

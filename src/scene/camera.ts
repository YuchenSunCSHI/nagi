export const camera = {
  height: 0.9,
  pitch: 0.12,
  horizontalScale: 0.55,
  verticalScale: 0.27,
  horizonMargin: 0.015
};

export interface WaterPoint {
  x: number;
  z: number;
}

export function waterPointAt(canvas: HTMLCanvasElement, clientX: number, clientY: number): WaterPoint | undefined {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return undefined;
  const screenX = (2 * (clientX - bounds.left) - bounds.width) / bounds.height;
  const screenY = (bounds.height - 2 * (clientY - bounds.top)) / bounds.height;
  const downward = camera.pitch - screenY * camera.verticalScale;
  if (downward <= camera.horizonMargin) return undefined;
  const depth = camera.height / downward;
  return { x: screenX * camera.horizontalScale * depth, z: depth };
}

/** Stereo position in the player's horizontal camera basis. */
export function panFor(point, listener, yaw) {
  if (!point) return 0;
  const dx=point.x-listener.x, dz=point.z-listener.z;
  const distance=Math.hypot(dx,dz);
  return distance < .001 ? 0 : Math.max(-1,Math.min(1,(dx*Math.cos(yaw)-dz*Math.sin(yaw))/distance));
}
export function audibleState(state) { return state === 'playing' || state === 'dead'; }

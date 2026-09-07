/** Stereo position in the player's horizontal camera basis. */
export function panFor(point, listener, yaw) {
  if (!point) return 0;
  const dx=point.x-listener.x, dz=point.z-listener.z;
  const distance=Math.hypot(dx,dz);
  return distance < .001 ? 0 : Math.max(-1,Math.min(1,(dx*Math.cos(yaw)-dz*Math.sin(yaw))/distance));
}
export function audibleState(state) { return state === 'playing' || state === 'dead'; }

/** Distance to the actual travelled shot segment, not its infinite aim ray. */
export function segmentDistance(point, from, to) {
  const x=to.x-from.x,y=to.y-from.y,z=to.z-from.z;
  const lengthSquared=x*x+y*y+z*z;
  const t=lengthSquared ? Math.max(0,Math.min(1,((point.x-from.x)*x+(point.y-from.y)*y+(point.z-from.z)*z)/lengthSquared)) : 0;
  return Math.hypot(point.x-from.x-t*x,point.y-from.y-t*y,point.z-from.z-t*z);
}

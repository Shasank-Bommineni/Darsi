export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function moveToward(cur, target, maxDelta) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function angleLerp(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

export const DEG = Math.PI / 180;
export const KMH = 3.6;

export function fmtDistance(m) {
  if (m < 950) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;
}

export function fmtClock(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  const ampm = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const search = (window.location && window.location.search) || '';
  const forced = new URLSearchParams(search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return (
    'ontouchstart' in window ||
    ((typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0) > 1 ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches)
  );
}

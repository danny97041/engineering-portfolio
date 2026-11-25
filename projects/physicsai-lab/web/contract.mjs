export const CONTRACT = 'physicsai.v1';
export const parity = Object.freeze({ atol: 1e-5, rtol: 1e-4, probes: 36 });
export function validatePoints(points, domain) {
  if (!Array.isArray(points) || points.length < 1 || points.length > 1024)
    throw new RangeError('Enter a batch of 1–1024 physical coordinates.');
  for (const row of points) {
    if (!Array.isArray(row) || row.length !== domain.length)
      throw new RangeError('Coordinate dimensions do not match this PDE.');
    domain.forEach(([lo, hi], i) => {
      if (!Number.isFinite(row[i]) || row[i] < lo || row[i] > hi)
        throw new RangeError('Coordinates must be finite numbers inside the physical domain.');
    });
  }
  return points;
}
export function matchesReference(value, reference) {
  return Number.isFinite(value) && Number.isFinite(reference) &&
    Math.abs(value - reference) <= parity.atol + parity.rtol * Math.abs(reference);
}
export function probePoints(domain) {
  // Two opposite corners, centre, lower face midpoint, then 32 asymmetric interior points.
  const bases = [2,3,5];
  function radical(n, base) {
    let sum = 0, weight = 1 / base;
    while (n > 0) { sum += (n % base) * weight; n = Math.floor(n / base); weight /= base; }
    return sum;
  }
  return Array.from({length: parity.probes}, (_, i) => domain.map(([lo,hi], j) => {
    if (i === 0) return lo;
    if (i === 1) return hi;
    const frac = i === 2 ? 0.5 : i === 3 ? (j === 0 ? 0 : 0.5) : radical(i - 3, bases[j]);
    return lo + (hi - lo) * frac;
  }));
}

/**
 * Button ring geometry.
 *
 * Sector numbering follows the community convention used by Simai charts:
 * buttons are numbered 1..8 clockwise. We place button 1 at the top of the
 * screen and unroll clockwise from button 5 (bottom) so that the default
 * keyboard binding reads left-to-right as a full clockwise sweep:
 *
 *   A S D F J K L ;   ->   5 6 7 8 1 2 3 4
 *
 * Screen space uses y-down; angle 0 = +x (right), 90 = +y (down).
 */

export const SECTOR_COUNT = 8;

/** Angle in degrees for each button (1..8). */
export const SECTOR_ANGLE: Readonly<Record<number, number>> = Object.freeze({
  1: 270,
  2: 315,
  3: 0,
  4: 45,
  5: 90,
  6: 135,
  7: 180,
  8: 225,
});

export function sectorAngle(sector: number): number {
  const angle = SECTOR_ANGLE[sector];
  if (angle === undefined) throw new Error(`Invalid sector: ${sector}`);
  return angle;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Signed shortest angular distance from `from` to `to`, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
  let d = ((to - from) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/** Clockwise distance along the ring from `from` to `to`, in [0, 360). */
export function clockwiseDistance(from: number, to: number): number {
  return ((to - from) % 360 + 360) % 360;
}

/** Counter-clockwise distance along the ring from `from` to `to`, in [0, 360). */
export function counterClockwiseDistance(from: number, to: number): number {
  return ((from - to) % 360 + 360) % 360;
}

/** Next sector clockwise (1..8). */
export function nextSector(sector: number): number {
  return (sector % SECTOR_COUNT) + 1;
}

/** Next sector counter-clockwise (1..8). */
export function prevSector(sector: number): number {
  return ((sector + SECTOR_COUNT - 2) % SECTOR_COUNT) + 1;
}

export function isSector(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= SECTOR_COUNT;
}

import { angleDelta, degToRad, sectorAngle } from './sectors';
import type { Note, SlideSpec } from './types';

export interface PathPoint {
  x: number;
  y: number;
}

export interface SlideWaypoint {
  sector: number;
  /** Time (chart ms) at which the trace reaches this button. */
  timeMs: number;
  x: number;
  y: number;
}

export interface SlidePath {
  points: PathPoint[];
  waypoints: SlideWaypoint[];
}

interface SlideGeometryOptions {
  radius?: number;
  samplesPerSegment?: number;
}

/**
 * Build a renderable polyline for a slide note in local coordinates
 * (origin = field center, +y down). This is purely cosmetic; judging only uses
 * the waypoint buttons and times.
 */
export function buildSlidePath(note: Note, options: SlideGeometryOptions = {}): SlidePath {
  const radius = options.radius ?? 1;
  const samples = options.samplesPerSegment ?? 24;
  const segments = note.slide ?? [];
  const points: PathPoint[] = [];
  const waypoints: SlideWaypoint[] = [];
  const startTime = note.timeMs + (note.slideWaitMs ?? 0);
  const totalDuration = Math.max(1, note.endMs - startTime);

  let current = note.sector;
  let elapsed = 0;

  for (const segment of segments) {
    const from = current;
    const local = segmentPoints(from, segment, radius, samples);
    if (points.length === 0) {
      points.push(local[0]!);
    }
    for (let i = 1; i < local.length; i++) points.push(local[i]!);
    elapsed += segment.durationMs;
    const frac = Math.min(1, elapsed / totalDuration);
    waypoints.push({
      sector: segment.to,
      timeMs: startTime + frac * totalDuration,
      ...pointAt(segment.to, radius),
    });
    current = segment.to;
  }

  if (points.length === 0) {
    points.push(pointAt(note.sector, radius));
    points.push(pointAt(note.sector, radius));
  }

  return { points, waypoints };
}

function segmentPoints(from: number, segment: SlideSpec, radius: number, samples: number): PathPoint[] {
  const start = pointAt(from, radius);
  const end = pointAt(segment.to, radius);
  const startAngle = sectorAngle(from);
  const endAngle = sectorAngle(segment.to);

  switch (segment.shape) {
    case '-':
      return line(start, end, samples);
    case 'w':
      // Wifi: up through the middle and back out; reads clearly on screen.
      return polyline([start, { x: 0, y: 0 }, end], samples);
    case 'V':
      return polyline([start, pointAt(segment.inflection ?? from, radius), end], samples);
    case 'pp':
    case 'qq':
      return bezier(start, { x: start.x * 0.25, y: start.y * 0.25 }, end, samples);
    case '<':
    case '>':
      return arcThrough(startAngle, endAngle, radius, samples, segment.shape === '>' ? 1 : -1);
    case '^':
    case 'v':
      return bezier(start, { x: 0, y: 0 }, end, samples, segment.shape === '^' ? 0.55 : -0.55);
    case 'p':
    case 'q':
      return bezier(start, { x: 0, y: 0 }, end, samples, segment.shape === 'p' ? 0.85 : -0.85);
    case 's':
    case 'z':
      return arcThrough(startAngle, endAngle, radius * 0.82, samples, segment.shape === 's' ? 1 : -1);
    default:
      return line(start, end, samples);
  }
}

function pointAt(sector: number, radius: number): PathPoint {
  const rad = degToRad(sectorAngle(sector));
  return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
}

function line(a: PathPoint, b: PathPoint, samples: number): PathPoint[] {
  const result: PathPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return result;
}

function polyline(points: PathPoint[], samples: number): PathPoint[] {
  const result: PathPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const part = line(a, b, Math.max(2, Math.floor(samples / (points.length - 1))));
    if (i > 0) part.shift();
    result.push(...part);
  }
  return result;
}

function bezier(a: PathPoint, control: PathPoint, b: PathPoint, samples: number, bend = 1): PathPoint[] {
  const result: PathPoint[] = [];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const c = {
    x: mid.x + (control.x - mid.x) * bend,
    y: mid.y + (control.y - mid.y) * bend,
  };
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const inv = 1 - t;
    result.push({
      x: inv * inv * a.x + 2 * inv * t * c.x + t * t * b.x,
      y: inv * inv * a.y + 2 * inv * t * c.y + t * t * b.y,
    });
  }
  return result;
}

/** Sample the ring segment between two sector angles, bulging toward the center. */
function arcThrough(
  startAngle: number,
  endAngle: number,
  radius: number,
  samples: number,
  direction: number,
): PathPoint[] {
  let delta = angleDelta(startAngle, endAngle);
  if (direction > 0 && delta < 0) delta += 360;
  if (direction < 0 && delta > 0) delta -= 360;
  // Use the short way around the ring for the remaining shapes.
  if (Math.abs(delta) > 270) delta = delta > 0 ? delta - 360 : delta + 360;

  const result: PathPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const angle = startAngle + delta * t;
    // Bow toward the center in the middle of the arc.
    const bow = Math.sin(Math.PI * t) * 0.42;
    const r = radius * (1 - bow);
    const rad = degToRad(angle);
    result.push({ x: Math.cos(rad) * r, y: Math.sin(rad) * r });
  }
  return result;
}

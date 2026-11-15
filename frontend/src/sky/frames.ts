/**
 * The frames of the SPHEREx all-sky cube: 102 maps of the whole sky, one for each
 * wavelength channel, published by IRSA as one HiPS cube.
 *
 * Frame k is channel (k mod 17) + 1 of detector floor(k / 17) + 1, in ascending
 * wavelength. The archive says frames 50 and 51 are blank: the two channels at the edge
 * of the dichroic.
 */

/** What the properties file of the cube says of its third axis. */
export interface CubeAxis {
  /** Number of frames. */
  depth: number;
  /** Shortest and longest wavelength of the cube, in micrometers. */
  shortest: number;
  longest: number;
  /** Wavelength of each frame, in micrometers. Empty when the file does not list them. */
  wavelengths: number[];
}

const CHANNELS_PER_DETECTOR = 17;
const BLANK_FRAMES = new Set([50, 51]);
const METERS_TO_MICROMETERS = 1e6;

/** Lines "key = value" of a HiPS properties file. Comments and empty lines are left out. */
export function parseProperties(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at < 1 || line.trimStart().startsWith("#")) {
      continue;
    }
    found.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return found;
}

/** The third axis of a cube, or null when the properties are not those of a cube. */
export function cubeAxisFrom(properties: Map<string, string>): CubeAxis | null {
  const depth = Number(properties.get("hips_cube_depth"));
  const shortest = Number(properties.get("em_min")) * METERS_TO_MICROMETERS;
  const longest = Number(properties.get("em_max")) * METERS_TO_MICROMETERS;
  if (!Number.isInteger(depth) || depth < 2 || !(shortest > 0) || !(longest > shortest)) {
    return null;
  }
  const listed = (properties.get("data_cube_crval3_arr") ?? "")
    .split(/\s+/)
    .filter((word) => word !== "")
    .map(Number);
  const complete = listed.length === depth && listed.every((value) => value > 0);
  return { depth, shortest, longest, wavelengths: complete ? listed : [] };
}

/**
 * Where the map engine must be told to look for it to load frame `frame`.
 *
 * Aladin Lite 3.8 reads a cube as a spectrum. It takes the number it is given as a step
 * along the frequencies, evenly spaced from the longest wavelength to the shortest, turns
 * that frequency back into a wavelength, and loads the frame an even spacing in
 * wavelength would put there. A whole number therefore lands on an unrelated frame: 60
 * loads frame 9. This gives the number that lands in the middle of the frame asked for.
 * Measured on the engine itself: the tests keep the pairs that were observed.
 */
export function sliceForFrame(frame: number, axis: CubeAxis): number {
  const span = axis.longest - axis.shortest;
  const wavelength = axis.shortest + ((frame + 0.5) / axis.depth) * span;
  const along = (1 / wavelength - 1 / axis.longest) / (1 / axis.shortest - 1 / axis.longest);
  return axis.depth * along;
}

/**
 * Frames the map can show, in ascending wavelength.
 *
 * Frame 0 is left out with the two blank ones: its tiles carry no frame number in their
 * name, and the engine never asks for a name without one.
 */
export function usableFrames(axis: CubeAxis): number[] {
  const frames: number[] = [];
  for (let frame = 1; frame < axis.depth; frame += 1) {
    if (!BLANK_FRAMES.has(frame)) {
      frames.push(frame);
    }
  }
  return frames;
}

/** Wavelength of a frame in micrometers, or null when the cube does not list it. */
export function wavelengthOf(frame: number, axis: CubeAxis): number | null {
  return axis.wavelengths[frame] ?? null;
}

/** Detector that saw a frame, from 1 to 6. */
export function detectorOf(frame: number): number {
  return Math.floor(frame / CHANNELS_PER_DETECTOR) + 1;
}

/** The usable frame closest to a wavelength. Falls back on the first one. */
export function nearestFrame(wavelength: number, axis: CubeAxis): number {
  const frames = usableFrames(axis);
  let best = frames[0] ?? 1;
  let smallest = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    const here = wavelengthOf(frame, axis);
    if (here === null) {
      continue;
    }
    const gap = Math.abs(here - wavelength);
    if (gap < smallest) {
      smallest = gap;
      best = frame;
    }
  }
  return best;
}

/** What the slider says of a frame: "1.65 µm, detector 3". */
export function frameLabel(frame: number, axis: CubeAxis): string {
  const wavelength = wavelengthOf(frame, axis);
  const where = `detector ${detectorOf(frame)}`;
  if (wavelength === null) {
    return `Channel ${frame + 1} of ${axis.depth}, ${where}`;
  }
  return `${wavelength.toFixed(2)} µm, ${where}`;
}

import { describe, expect, it } from "vitest";
import {
  type CubeAxis,
  cubeAxisFrom,
  detectorOf,
  frameLabel,
  nearestFrame,
  parseProperties,
  sliceForFrame,
  usableFrames,
  wavelengthOf,
} from "./frames";

const WAVELENGTHS = Array.from({ length: 102 }, (_, frame) => 0.753 + frame * 0.0421);

// What the archive answers, shortened: the real file lists 102 wavelengths.
const PROPERTIES = `
# A comment
creator_did          = ivo://IPAC/P/SPHEREx/DR1/cube
obs_title            = SPHEREx DR1 all-sky data cube
dataproduct_type     = cube
hips_cube_depth      = 102
hips_cube_firstframe = 1
em_min               = 7.430000e-07
em_max               = 5.009000e-06
data_cube_crval3_arr = ${WAVELENGTHS.map((value) => value.toFixed(3)).join(" ")}
hips_pixel_cut       = 0 40
`;

const AXIS = cubeAxisFrom(parseProperties(PROPERTIES)) as CubeAxis;

/**
 * The frame Aladin Lite 3.8 loads for a slice number. Not its code: what it was seen to
 * do on the SPHEREx cube, slice after slice, in the browser.
 */
function frameTheEngineLoads(slice: number, axis: CubeAxis): number {
  const lowest = 1 / axis.longest;
  const highest = 1 / axis.shortest;
  const wavelength = 1 / (lowest + (slice / axis.depth) * (highest - lowest));
  return Math.floor(((wavelength - axis.shortest) / (axis.longest - axis.shortest)) * axis.depth);
}

describe("the properties of the cube", () => {
  it("are read as keys and values", () => {
    const read = parseProperties(PROPERTIES);
    expect(read.get("obs_title")).toBe("SPHEREx DR1 all-sky data cube");
    expect(read.get("hips_pixel_cut")).toBe("0 40");
    expect(read.has("# A comment")).toBe(false);
  });

  it("give the third axis in micrometers", () => {
    expect(AXIS.depth).toBe(102);
    expect(AXIS.shortest).toBeCloseTo(0.743, 6);
    expect(AXIS.longest).toBeCloseTo(5.009, 6);
    expect(AXIS.wavelengths).toHaveLength(102);
    expect(wavelengthOf(0, AXIS)).toBeCloseTo(0.753, 3);
  });

  it("are refused when they are not those of a cube", () => {
    expect(cubeAxisFrom(parseProperties("dataproduct_type = image"))).toBeNull();
    expect(
      cubeAxisFrom(parseProperties("hips_cube_depth = 102\nem_min = 5e-6\nem_max = 1e-6")),
    ).toBeNull();
  });

  it("keep no list of wavelengths that does not match the depth", () => {
    const short = cubeAxisFrom(
      parseProperties(
        "hips_cube_depth = 102\nem_min = 7.43e-7\nem_max = 5.009e-6\ndata_cube_crval3_arr = 0.75 0.77",
      ),
    ) as CubeAxis;
    expect(short.wavelengths).toEqual([]);
    expect(wavelengthOf(3, short)).toBeNull();
    expect(frameLabel(3, short)).toBe("Channel 4 of 102, detector 1");
  });
});

describe("the slice number the engine needs", () => {
  it("is not the frame number: these pairs were seen in the browser", () => {
    expect(frameTheEngineLoads(1, AXIS)).toBe(95);
    expect(frameTheEngineLoads(60, AXIS)).toBe(9);
    expect(frameTheEngineLoads(101, AXIS)).toBe(0);
  });

  it("matches what loaded the right tiles in the browser", () => {
    expect(sliceForFrame(1, AXIS)).toBeCloseTo(92.675, 3);
    expect(sliceForFrame(17, AXIS)).toBeCloseTo(42.568, 3);
    expect(sliceForFrame(33, AXIS)).toBeCloseTo(23.738, 3);
    expect(sliceForFrame(60, AXIS)).toBeCloseTo(9.42, 3);
    expect(sliceForFrame(100, AXIS)).toBeCloseTo(0.225, 3);
  });

  it("lands on the frame asked for, for every frame the map shows", () => {
    for (const frame of usableFrames(AXIS)) {
      expect(frameTheEngineLoads(sliceForFrame(frame, AXIS), AXIS)).toBe(frame);
    }
  });
});

describe("the frames the map shows", () => {
  it("leave out the first frame and the two blank ones", () => {
    const frames = usableFrames(AXIS);
    expect(frames).toHaveLength(99);
    expect(frames[0]).toBe(1);
    expect(frames).not.toContain(50);
    expect(frames).not.toContain(51);
    expect(frames.at(-1)).toBe(101);
  });

  it("belong to one of six detectors, seventeen each", () => {
    expect(detectorOf(0)).toBe(1);
    expect(detectorOf(16)).toBe(1);
    expect(detectorOf(17)).toBe(2);
    expect(detectorOf(101)).toBe(6);
  });

  it("are found by wavelength, never a blank one", () => {
    expect(nearestFrame(0.1, AXIS)).toBe(1);
    expect(nearestFrame(99, AXIS)).toBe(101);
    const blank = wavelengthOf(50, AXIS) as number;
    expect([49, 52]).toContain(nearestFrame(blank, AXIS));
    expect(nearestFrame(wavelengthOf(33, AXIS) as number, AXIS)).toBe(33);
  });

  it("are named by wavelength and detector", () => {
    expect(frameLabel(33, AXIS)).toBe("2.14 µm, detector 2");
  });
});

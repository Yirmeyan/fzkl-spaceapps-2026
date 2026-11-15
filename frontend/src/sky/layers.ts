/** The skies the map can show. SPHEREx comes first: the others are there to compare. */

export interface SkyLayer {
  key: string;
  /** Name in the list. */
  label: string;
  /** Address of the HiPS: a tree of image tiles that covers the sky. */
  url: string;
  /** True for a cube: one map for each wavelength, chosen with the slider. */
  cube: boolean;
  /** Who made the image and who serves it, shown under the map. */
  credit: string;
}

export const SPHEREX_CUBE_URL =
  "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";

// The sky atlas of ESA serves the classic surveys as HiPS, for any page to show.
const ESA_SKY = "https://skies.esac.esa.int";

export const SKY_LAYERS: readonly SkyLayer[] = [
  {
    key: "spherex",
    label: "SPHEREx, 102 wavelengths",
    url: SPHEREX_CUBE_URL,
    cube: true,
    credit:
      "SPHEREx DR1 all-sky data cube, NASA/SPHEREx, SPHEREx Science Data Center, served by IRSA (Caltech/IPAC)",
  },
  {
    key: "wise",
    label: "WISE, mid-infrared",
    url: `${ESA_SKY}/AllWISEColor`,
    cube: false,
    credit: "AllWISE, NASA/JPL-Caltech/UCLA, served by ESA Sky",
  },
  {
    key: "2mass",
    label: "2MASS, near-infrared",
    url: `${ESA_SKY}/2MASSColor`,
    cube: false,
    credit: "2MASS, UMass/IPAC-Caltech/NASA/NSF, served by ESA Sky",
  },
  {
    key: "visible",
    label: "Visible light",
    url: `${ESA_SKY}/DSSColor`,
    cube: false,
    credit: "Digitized Sky Survey, STScI/NASA, colored by the CDS, served by ESA Sky",
  },
];

export const DEFAULT_LAYER_KEY = "spherex";

/** The layer of a key, or the SPHEREx one when the key is unknown. */
export function layerOf(key: string | null | undefined): SkyLayer {
  return SKY_LAYERS.find((layer) => layer.key === key) ?? SKY_LAYERS[0];
}

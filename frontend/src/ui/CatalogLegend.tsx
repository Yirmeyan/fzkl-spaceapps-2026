import { CATALOG_COLORS } from "../viewer/overlays";
import { SURVEYS } from "./copy";

interface CatalogLegendProps {
  gaia: boolean;
  wise: boolean;
}

/** Says what each ring drawn over the picture stands for. Nothing while no catalog is shown. */
export function CatalogLegend({ gaia, wise }: CatalogLegendProps) {
  if (!gaia && !wise) return null;
  return (
    <ul className="catalog-legend" aria-label="What the rings over the picture are">
      {gaia && (
        <li>
          <span
            className="catalog-legend-ring"
            style={{ borderColor: CATALOG_COLORS.gaia }}
            aria-hidden="true"
          />
          {SURVEYS.legendGaia}
        </li>
      )}
      {wise && (
        <li>
          <span
            className="catalog-legend-ring"
            style={{ borderColor: CATALOG_COLORS.allwise }}
            aria-hidden="true"
          />
          {SURVEYS.legendWise}
        </li>
      )}
      <li>
        <span className="catalog-legend-blank" aria-hidden="true" />
        {SURVEYS.legendBlank}
      </li>
      <li className="catalog-legend-note">
        {wise ? `${SURVEYS.legendGap} ` : ""}
        {SURVEYS.legendMost}
      </li>
    </ul>
  );
}

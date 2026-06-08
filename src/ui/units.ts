/**
 * Length formatting for the two unit systems the UI offers. The cave model is
 * always stored in metres (per the parsers); these helpers convert at the
 * display boundary only.
 */
export type UnitSystem = "metric" | "imperial";

const FEET_PER_METRE = 3.280839895;
const FEET_PER_MILE = 5280;

/** The short unit suffix used when values share one label (e.g. extent). */
export function unitLabel(units: UnitSystem): string {
  return units === "imperial" ? "ft" : "m";
}

/** Converts a length in metres to the chosen unit's base (metres or feet). */
export function toDisplayLength(metres: number, units: UnitSystem): number {
  return units === "imperial" ? metres * FEET_PER_METRE : metres;
}

/**
 * Formats a total length, rolling up to km / miles for large values. Mirrors
 * the metric formatting the HUD used before units were configurable.
 */
export function formatLength(metres: number, units: UnitSystem): string {
  if (units === "imperial") {
    const feet = metres * FEET_PER_METRE;
    return feet >= FEET_PER_MILE
      ? `${(feet / FEET_PER_MILE).toFixed(2)} mi`
      : `${feet.toFixed(0)} ft`;
  }
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${metres.toFixed(1)} m`;
}

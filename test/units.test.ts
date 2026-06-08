import { describe, expect, it } from "vitest";
import { formatLength, toDisplayLength, unitLabel } from "../src/ui/units";

describe("units", () => {
  it("labels the short unit per system", () => {
    expect(unitLabel("metric")).toBe("m");
    expect(unitLabel("imperial")).toBe("ft");
  });

  it("converts metres to feet for imperial, leaves metric untouched", () => {
    expect(toDisplayLength(100, "metric")).toBe(100);
    expect(toDisplayLength(100, "imperial")).toBeCloseTo(328.084, 2);
  });

  it("formats metric length, rolling up to km past 1000 m", () => {
    expect(formatLength(250, "metric")).toBe("250.0 m");
    expect(formatLength(2500, "metric")).toBe("2.50 km");
  });

  it("formats imperial length, rolling up to miles past one mile", () => {
    expect(formatLength(100, "imperial")).toBe("328 ft");
    expect(formatLength(2000, "imperial")).toBe("1.24 mi");
  });
});

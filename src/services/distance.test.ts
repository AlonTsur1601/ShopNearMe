import { describe, expect, it } from "vitest";
import { displayDistance, distanceUnitFor } from "./distance";

describe("localized distance display", () => {
  it("uses kilometers in Israel and most metric locales", () => {
    expect(distanceUnitFor("Petah Tikva, Israel")).toBe("km");
    expect(displayDistance(3.1, "km")).toBe("5.0 km");
  });

  it("uses miles in the United States and United Kingdom", () => {
    expect(distanceUnitFor("Austin, United States")).toBe("mi");
    expect(distanceUnitFor("London, England")).toBe("mi");
    expect(displayDistance(3.1, "mi")).toBe("3.1 mi");
  });
});

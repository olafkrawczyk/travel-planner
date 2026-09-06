import { describe, expect, it } from "vitest";
import { haversineKm } from "./index";

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(35.6812, 139.7671, 35.6812, 139.7671)).toBe(0);
  });

  it("Tokyo Station → Senso-ji is roughly 5 km", () => {
    const d = haversineKm(35.6812, 139.7671, 35.7148, 139.7967);
    expect(d).toBeGreaterThan(4);
    expect(d).toBeLessThan(6);
  });

  it("1 degree of latitude ≈ 111 km", () => {
    const d = haversineKm(0, 0, 1, 0);
    expect(d).toBeCloseTo(111.2, 0);
  });

  it("is symmetric", () => {
    const a = haversineKm(35.0, 139.0, 36.5, 140.5);
    const b = haversineKm(36.5, 140.5, 35.0, 139.0);
    expect(a).toBeCloseTo(b, 10);
  });
});

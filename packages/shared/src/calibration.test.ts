import { describe, expect, it } from "vitest";
import { inchesFromAdc, isDecreasing } from "./calibration.js";
import { samplesFromBody } from "./ingest.js";

describe("inchesFromAdc", () => {
  const cal = { adc1: 200, inches1: 4, adc2: 600, inches2: 20 };
  it("passes through both calibration points", () => {
    expect(inchesFromAdc(200, cal)).toBeCloseTo(4);
    expect(inchesFromAdc(600, cal)).toBeCloseTo(20);
  });
  it("interpolates and extrapolates", () => {
    expect(inchesFromAdc(400, cal)).toBeCloseTo(12);
    expect(inchesFromAdc(0, cal)).toBeCloseTo(-4);
  });
  it("detects a falling calibration", () => {
    expect(isDecreasing(cal)).toBe(false);
    expect(isDecreasing({ adc1: 0, inches1: 30, adc2: 1000, inches2: 0 })).toBe(true);
  });
});

describe("samplesFromBody", () => {
  it("places evenly spaced samples before the arrival time, newest last", () => {
    expect(samplesFromBody({ samples: [1, 2, 3], interval_ms: 500 })).toEqual([
      { adc: 1, agoMs: 1000 },
      { adc: 2, agoMs: 500 },
      { adc: 3, agoMs: 0 },
    ]);
  });
  it("keeps explicit ages and treats a single value as now", () => {
    expect(samplesFromBody({ readings: [{ adc: 9, ago_ms: 250 }] })).toEqual([{ adc: 9, agoMs: 250 }]);
    expect(samplesFromBody({ adc: 7 })).toEqual([{ adc: 7, agoMs: 0 }]);
  });
});

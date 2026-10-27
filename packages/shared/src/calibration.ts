/**
 * A two-point linear calibration: two raw readings and the height (inches) measured at each.
 * Raw values are whatever the device's ADC reports (0-1023 on an Arduino).
 */
export interface Calibration {
  adc1: number;
  inches1: number;
  adc2: number;
  inches2: number;
}

/** Used until a real calibration is entered: the full 10-bit range mapped to 0-40 inches. */
export const PLACEHOLDER_CALIBRATION: Calibration = { adc1: 0, inches1: 0, adc2: 1023, inches2: 40 };

export function inchesFromAdc(adc: number, cal: Calibration): number {
  const slope = (cal.inches2 - cal.inches1) / (cal.adc2 - cal.adc1);
  return cal.inches1 + (adc - cal.adc1) * slope;
}

/** True when a larger raw value means a lower water level (the min and max swap on conversion). */
export function isDecreasing(cal: Calibration): boolean {
  return (cal.inches2 - cal.inches1) / (cal.adc2 - cal.adc1) < 0;
}

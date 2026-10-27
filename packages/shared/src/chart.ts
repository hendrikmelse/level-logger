/** One level reading as the viewer shows it. */
export interface CurrentLevel {
  device: { id: number; name: string };
  /** Null until the device has sent anything. */
  reading: { at: string; adc: number; inches: number; ageSeconds: number } | null;
}

/** Aggregated levels over a time range, as parallel arrays (the shape the chart library wants). */
export interface ChartSeries {
  /** Width of each bucket in seconds; 1 means raw readings. */
  bucketSeconds: number;
  /** Start of each bucket, in epoch seconds. Buckets with no data are left out. */
  t: number[];
  avg: number[];
  min: number[];
  max: number[];
}

export interface DeviceInfo {
  id: number;
  name: string;
}

import type { ChartSeries, CurrentLevel, DeviceInfo } from "@level-logger/shared";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${path} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchDevices = () => get<DeviceInfo[]>("/devices");
export const fetchCurrent = (id: number) => get<CurrentLevel>(`/devices/${id}/current`);
export const fetchChart = (id: number, from: number, to: number, maxPoints: number) =>
  get<ChartSeries>(`/devices/${id}/chart?from=${from}&to=${to}&maxPoints=${maxPoints}`);

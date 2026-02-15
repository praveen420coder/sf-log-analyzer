export interface Log {
  Id?: string;
  id?: string;
  StartTime?: string;
  startTime?: string;
  Status?: string;
  status?: string;
  LogLength?: number;
  size?: string;
  Operation?: string;
  details?: string;
}

export interface Metric {
  label: string;
  value: string;
}
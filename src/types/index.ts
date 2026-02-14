export interface Log {
  id: string;
  startTime: string;
  status: 'Success' | 'Error';
  size: string;
  details: string;
}

export interface Metric {
  label: string;
  value: string;
}
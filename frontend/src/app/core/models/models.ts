export enum CalculationStatus {
  Waiting = 'waiting',
  Extracting = 'extracting',
  Calculating = 'calculating',
  Done = 'done',
  Error = 'error'
}

export interface Order {
  id: string;
  status: CalculationStatus;
  createdAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
}

export interface Parameter {
  name: string;
  value: string;
  source: string;
}

export interface User {
  id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
}

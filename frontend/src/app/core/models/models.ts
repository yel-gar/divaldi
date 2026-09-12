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

export interface CreateOrderPayload {
  description: string;
  projectType: string;
  priority: string;
  files: File[];
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
  is_superuser: boolean;
}

export type UploadState = 'idle' | 'uploading' | 'completed';

export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'error';

export interface UploadItem {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly extension: string;
  readonly file: File;
  readonly status: UploadItemStatus;
  readonly uploaded: number;
}

export interface UploadSpeedSample {
  readonly time: number;
  readonly bytes: number;
}

export const MAX_CONCURRENT_UPLOADS = 3;

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [
  '.pdf',
  '.dwg',
  '.dxf',
  '.xls',
  '.xlsx',
  '.doc',
  '.docx',
  '.png',
  '.jpeg',
  '.jpg'
] as const;

export const VISIBLE_FILES_LIMIT = 5;

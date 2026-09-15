export interface ChatCreated {
  session_id: string;
}

export interface ChatAttachmentApi {
  id: number;
  name: string;
}

export interface ChatUploadParams {
  attachment_id: number;
  params: { url: string; fields: Record<string, string> };
}

export type ChatAttachmentStatus = 'uploading' | 'processing' | 'completed' | 'error';

export interface ChatAttachmentUrl {
  attachment_url: string;
  filename: string;
}

export interface ChatMessageApi {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments: ChatAttachmentApi[];
  timestamp: string;
}

export interface UserChat {
  session_id: string;
  last_message: ChatMessageApi;
  name: string;
}

export interface ChatResultContent {
  type: 'error' | 'success';
  content: string;
  timestamp: string;
  attachment_id: number | null;
  update_name: string | null;
}

export interface ChatResult {
  running: boolean;
  result: ChatResultContent | null;
}

export interface User {
  id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
  is_superuser: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
  is_superuser: boolean;
  expires_at: string | null;
}

export interface AdminUserPayload {
  username: string;
  password?: string;
  first_name: string | null;
  last_name: string | null;
  expires_at: string | null;
}

export interface MessageResponse {
  message: string;
}

export const KP_FILENAME = 'kp.xlsx';

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

export const MAX_FILE_SIZE = 30 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = ['.pdf', '.dxf', '.png', '.jpeg', '.jpg'] as const;

export const VISIBLE_FILES_LIMIT = 5;

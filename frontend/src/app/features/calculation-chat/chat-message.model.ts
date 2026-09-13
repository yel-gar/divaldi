export type ChatMessageDirection = 'incoming' | 'outgoing';

export type ChatMessageStatus = 'sending' | 'sent';

export interface ChatMessageAttachment {
  name: string;
  size: number;
  file?: File;
}

export interface ChatMessage {
  id: number;
  direction: ChatMessageDirection;
  text: string;
  time: string;
  timestamp?: string;
  status?: ChatMessageStatus;
  attachments?: ChatMessageAttachment[];
}

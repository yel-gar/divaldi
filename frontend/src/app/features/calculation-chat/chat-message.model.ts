export type ChatMessageDirection = 'incoming' | 'outgoing';

export type ChatMessageStatus = 'sending' | 'sent' | 'read';

export interface ChatMessage {
  id: number;
  direction: ChatMessageDirection;
  text: string;
  time: string;
  status?: ChatMessageStatus;
}

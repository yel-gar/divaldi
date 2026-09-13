import { Injectable, signal } from '@angular/core';

export interface InitialChatMessage {
  text: string;
  files: File[];
}

@Injectable({
  providedIn: 'root'
})
export class InitialChatStateService {
  private readonly message = signal<InitialChatMessage | null>(null);

  set(message: InitialChatMessage): void {
    this.message.set(message);
  }

  consume(): InitialChatMessage | null {
    const message = this.message();
    this.message.set(null);
    return message;
  }
}

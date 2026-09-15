import { Injectable, signal } from '@angular/core';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private lastError = { message: '', time: 0 };

  readonly notifications = signal<Notification[]>([]);

  success(message: string): void {
    this.add('success', message);
  }

  error(message: string): void {
    this.add('error', message);
  }

  errorOnce(message: string, windowMs = 3000): void {
    const now = Date.now();
    if (this.lastError.message === message && now - this.lastError.time < windowMs) {
      return;
    }
    this.lastError = { message, time: now };
    this.error(message);
  }

  info(message: string): void {
    this.add('info', message);
  }

  warning(message: string): void {
    this.add('warning', message);
  }

  remove(id: string): void {
    this.notifications.update((list) => list.filter((n) => n.id !== id));
  }

  private add(type: Notification['type'], message: string): void {
    const id = crypto.randomUUID();
    this.notifications.set([{ id, type, message }]);
  }
}

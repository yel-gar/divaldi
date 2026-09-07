import { Injectable, signal } from '@angular/core';

export interface Notification {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  readonly notifications = signal<Notification[]>([]);
  private nextId = 0;

  success(message: string): void {
    this.add('success', message);
  }

  error(message: string): void {
    this.add('error', message);
  }

  info(message: string): void {
    this.add('info', message);
  }

  warning(message: string): void {
    this.add('warning', message);
  }

  remove(id: number): void {
    this.notifications.update((list) => list.filter((n) => n.id !== id));
  }

  private add(type: Notification['type'], message: string): void {
    const id = this.nextId++;
    this.notifications.update((list) => [...list, { id, type, message }]);
    setTimeout(() => this.remove(id), 5000);
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { NotificationService } from '../../../core/services/notification.service';
import type { Notification as NotificationData } from '../../../core/services/notification.service';
import { Notification } from './notification.component';

const NOTIFICATION_DURATION_MS = 5000;
const LEAVE_ANIMATION_MS = 220;

@Component({
  selector: 'app-notifications',
  imports: [Notification],
  standalone: true,
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationsComponent {
  private readonly notificationService = inject(NotificationService);

  private readonly notifications = this.notificationService.notifications;
  readonly leaving = signal<NotificationData[]>([]);

  readonly displayed = computed<NotificationData | null>(
    () => this.leaving()[0] ?? this.notifications()[0] ?? null
  );
  private readonly headId = computed(() => this.notifications()[0]?.id ?? null);

  constructor() {
    let previousItems = new Map(this.notifications().map((n) => [n.id, n]));

    effect((onCleanup) => {
      const id = this.headId();
      if (!id) {
        return;
      }
      const timer = setTimeout(() => this.close(id), NOTIFICATION_DURATION_MS);
      onCleanup(() => clearTimeout(timer));
    });

    effect(() => {
      const currentIds = new Set(this.notifications().map((n) => n.id));
      const gone = [...previousItems.values()].filter((n) => !currentIds.has(n.id));
      previousItems = new Map(this.notifications().map((n) => [n.id, n]));

      if (gone.length === 0) {
        return;
      }

      this.leaving.update((list) => [...list, ...gone]);
      setTimeout(() => {
        const goneIds = new Set(gone.map((n) => n.id));
        this.leaving.update((list) => list.filter((n) => !goneIds.has(n.id)));
      }, LEAVE_ANIMATION_MS);
    });
  }

  isLeaving(id: string): boolean {
    return this.leaving().some((n) => n.id === id);
  }

  close(id: string) {
    this.notificationService.remove(id);
  }
}

import { booleanAttribute, ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import {
  LucideCircleCheck,
  LucideCircleX,
  LucideInfo,
  LucideTriangleAlert,
  LucideX
} from '@lucide/angular';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

@Component({
  selector: 'app-notification',
  imports: [LucideCircleCheck, LucideCircleX, LucideInfo, LucideTriangleAlert, LucideX],
  standalone: true,
  templateUrl: './notification.html',
  styleUrl: './notification.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    '[attr.data-type]': 'type()',
    '[class.notification--leaving]': 'leaving()'
  }
})
export class Notification {
  readonly type = input.required<NotificationType>();
  readonly title = input.required<string>();
  readonly description = input<string>();
  readonly dismissible = input(false, { transform: booleanAttribute });
  readonly leaving = input(false);

  readonly closed = output<void>();
}

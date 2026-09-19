import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideChevronRight, LucideChevronsUpDown } from '@lucide/angular';
import { ChatService } from '../../core/services/chat.service';
import { UserChat } from '../../core/models/models';
import { SkeletonHistoryTableComponent } from '../../shared/components/skeleton/skeleton-history-table/skeleton-history-table.component';

type SortColumn = 'number' | 'date';
type SortDirection = 'asc' | 'desc';

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

@Component({
  selector: 'app-history-page',
  imports: [LucideChevronsUpDown, LucideChevronRight, SkeletonHistoryTableComponent, RouterLink],
  templateUrl: './history-page.component.html',
  styleUrl: './history-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HistoryPage {
  private readonly chatService = inject(ChatService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly sessions = signal<UserChat[]>([]);
  readonly sortColumn = signal<SortColumn>('date');
  readonly sortDirection = signal<SortDirection>('desc');

  readonly sortedSessions = computed(() => {
    const chats = [...this.sessions()];
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    if (this.sortColumn() === 'date') {
      return chats.sort(
        (a, b) =>
          direction *
          (timestampMs(a.last_message.timestamp) - timestampMs(b.last_message.timestamp))
      );
    }
    return chats.sort((a, b) => direction * a.session_id.localeCompare(b.session_id));
  });

  constructor() {
    this.chatService
      .list()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((chats) => this.sessions.set(chats));
  }

  toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.sortColumn.set(column);
    this.sortDirection.set(column === 'date' ? 'desc' : 'asc');
  }

  ariaSortFor(column: SortColumn): 'ascending' | 'descending' | 'none' {
    if (this.sortColumn() !== column) {
      return 'none';
    }
    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  open(sessionId: string): void {
    this.router.navigate(['/chats', sessionId]);
  }

  shortId(sessionId: string): string {
    return sessionId.slice(0, 8);
  }

  formatDate(timestamp: string): string {
    return new Date(timestamp).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

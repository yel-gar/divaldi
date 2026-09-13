import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { LucideChevronRight, LucideChevronsUpDown } from '@lucide/angular';
import { ChatService } from '../../core/services/chat.service';
import { UserChat } from '../../core/models/models';
import { Spinner } from '../../shared/components/spinner/spinner.component';

type SortColumn = 'number' | 'date';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-history-page',
  imports: [LucideChevronsUpDown, LucideChevronRight, Spinner, RouterLink],
  templateUrl: './history-page.html',
  styleUrl: './history-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HistoryPage {
  private readonly chatService = inject(ChatService);
  private readonly router = inject(Router);

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
          direction * (Date.parse(a.last_message.timestamp) - Date.parse(b.last_message.timestamp))
      );
    }
    return chats.sort((a, b) => direction * a.session_id.localeCompare(b.session_id));
  });

  constructor() {
    this.chatService
      .list()
      .pipe(finalize(() => this.loading.set(false)))
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

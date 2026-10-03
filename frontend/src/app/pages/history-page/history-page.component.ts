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
import { CHATS_PAGE_SIZE, ChatService } from '../../core/services/chat.service';
import { ChatSortKey, SortOrder, UserChat } from '../../core/models/models';
import { SkeletonHistoryTableComponent } from '../../shared/components/skeleton/skeleton-history-table/skeleton-history-table.component';

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

  readonly itemsPerPage = CHATS_PAGE_SIZE;
  readonly loading = signal(true);
  readonly sessions = signal<UserChat[]>([]);
  readonly total = signal(0);
  readonly page = signal(0);
  readonly sortColumn = signal<ChatSortKey>('date');
  readonly sortDirection = signal<SortOrder>('desc');

  private lastRequestId = 0;

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.itemsPerPage)));
  readonly canGoBack = computed(() => this.page() > 0);
  readonly canGoForward = computed(() => this.page() + 1 < this.totalPages());

  constructor() {
    this.loadPage();
  }

  private loadPage(): void {
    // Two clicks in quick succession produce two in-flight requests, and the slower one
    // must not overwrite the page the faster one already rendered.
    const requestId = ++this.lastRequestId;
    this.loading.set(true);
    this.chatService
      .list({
        page: this.page(),
        itemsPerPage: this.itemsPerPage,
        sort: this.sortColumn(),
        order: this.sortDirection()
      })
      .pipe(
        finalize(() => {
          if (requestId === this.lastRequestId) {
            this.loading.set(false);
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (response) => {
          if (requestId !== this.lastRequestId) {
            return;
          }
          this.sessions.set(response.items);
          this.total.set(response.total);
          // Taken from the response rather than assumed, so a failed request cannot leave
          // the pager claiming a page it never loaded.
          this.page.set(response.page);
        },
        error: () => {
          if (requestId !== this.lastRequestId) {
            return;
          }
          this.sessions.set([]);
          this.total.set(0);
          this.page.set(0);
        }
      });
  }

  toggleSort(column: ChatSortKey): void {
    const nextDirection: SortOrder =
      this.sortColumn() === column && this.sortDirection() === 'asc' ? 'desc' : 'asc';
    this.sortColumn.set(column);
    this.sortDirection.set(nextDirection);
    // Sorting is a server-side query, so a new order means a new request from page one:
    // page 2 of the old order has nothing to do with page 2 of the new one.
    this.page.set(0);
    this.loadPage();
  }

  previousPage(): void {
    this.page.update((page) => page - 1);
    this.loadPage();
  }

  nextPage(): void {
    this.page.update((page) => page + 1);
    this.loadPage();
  }

  ariaSortFor(column: ChatSortKey): 'ascending' | 'descending' | 'none' {
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

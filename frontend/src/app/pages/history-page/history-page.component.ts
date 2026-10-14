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
import { LucideChevronRight, LucideSearch } from '@lucide/angular';
import { CHATS_PAGE_SIZE, ChatService } from '../../core/services/chat.service';
import { ChatSortKey, SortOrder, UserChat } from '../../core/models/models';
import { SkeletonUsersTableComponent } from '../../shared/components/skeleton/skeleton-users-table/skeleton-users-table.component';
import { InputComponent } from '../../shared/components/input/input.component';
import {
  Table,
  TableColumn,
  TableCell,
  TableSort
} from '../../shared/components/table/table.component';

@Component({
  selector: 'app-history-page',
  imports: [
    LucideChevronRight,
    LucideSearch,
    SkeletonUsersTableComponent,
    RouterLink,
    InputComponent,
    Table,
    TableCell
  ],
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
  readonly search = signal('');
  readonly total = signal(0);
  readonly page = signal(0);
  readonly historySort = signal<TableSort>({ column: 'date', direction: 'desc' });

  private lastRequestId = 0;

  readonly historyColumns: TableColumn<UserChat>[] = [
    {
      key: 'number',
      label: '№ заявки',
      sortable: true,
      text: (chat) => this.shortId(chat.session_id)
    },
    {
      key: 'date',
      label: 'Дата создания',
      sortable: true,
      align: 'center',
      text: (chat) => this.formatDate(chat.last_message.timestamp)
    },
    { key: 'message', label: 'Последнее сообщение' },
    { key: 'open', label: 'Открыть заявку', align: 'right', visuallyHidden: true }
  ];

  readonly rowKey = (chat: UserChat) => chat.session_id;

  readonly filteredSessions = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.sessions();
    }
    return this.sessions().filter(
      (session) =>
        this.shortId(session.session_id).includes(query) ||
        session.last_message.content.toLowerCase().includes(query)
    );
  });

  readonly searchIcon = LucideSearch;

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
        sort: this.historySort().column as ChatSortKey,
        order: this.historySort().direction as SortOrder
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

  onSortChange(sort: TableSort): void {
    this.historySort.set(sort);
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

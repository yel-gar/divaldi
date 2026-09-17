import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import {
  LucideDynamicIcon,
  LucideLogOut,
  LucideMessageSquare,
  LucidePanelLeftClose,
  LucidePanelLeftOpen,
  LucidePlus,
  LucideShieldCheck
} from '@lucide/angular';
import { AuthService } from '../../../core/services/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ProfileService } from '../../../core/services/profile.service';
import type { UserChat } from '../../../core/models/models';
import { Spinner } from '../spinner/spinner.component';
import type { NavItem, Role } from './sidebar.config';

export interface SidebarHistoryItem {
  readonly id: string;
  readonly title: string;
  readonly timestamp: number;
}

const CHAT_URL_PATTERN = /^\/chats\/([^/?#]+)/;

function toHistoryItem(chat: UserChat): SidebarHistoryItem {
  const parsedTimestamp = Date.parse(chat.last_message?.timestamp ?? '');
  return {
    id: chat.session_id,
    title: chat.name?.trim() || chat.session_id.slice(0, 8),
    timestamp: Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp
  };
}

@Component({
  selector: 'app-sidebar',
  imports: [
    LucideDynamicIcon,
    RouterLink,
    RouterLinkActive,
    LucidePlus,
    LucideMessageSquare,
    LucidePanelLeftClose,
    LucidePanelLeftOpen,
    LucideLogOut,
    Spinner
  ],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.sidebar--collapsed]': 'collapsed()'
  }
})
export class Sidebar implements OnInit {
  private static readonly ADMIN_PANEL_ITEM: NavItem = {
    label: 'Перейти в админ-панель',
    icon: LucideShieldCheck,
    route: '/admin/users'
  };

  readonly navItems = input<NavItem[]>([]);
  readonly role = input<Role>();
  private readonly auth = inject(AuthService);
  private readonly chatService = inject(ChatService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly notifications = inject(NotificationService);
  private readonly profile = inject(ProfileService);
  private readonly router = inject(Router);

  readonly user = this.profile.user;
  readonly visibleNavItems = computed<NavItem[]>(() => {
    const items = this.navItems();
    if (this.role() !== 'user' || !this.user()?.is_superuser) {
      return items;
    }
    return [...items, Sidebar.ADMIN_PANEL_ITEM];
  });
  readonly displayName = computed(() => {
    const user = this.user();
    if (!user) {
      return '';
    }
    const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return name || user.username;
  });
  readonly isLoggingOut = signal(false);

  readonly chats = signal<SidebarHistoryItem[]>([]);
  readonly chatsLoading = signal(false);
  readonly chatsError = signal(false);
  private readonly historyLoaded = signal(false);

  readonly sortedChats = computed(() =>
    [...this.chats()].sort((a, b) => b.timestamp - a.timestamp)
  );

  private readonly routerEvents = toSignal(this.router.events, { initialValue: null });

  readonly activeChatId = computed(() => {
    const event = this.routerEvents();
    const url = event instanceof NavigationEnd ? event.urlAfterRedirects : this.router.url;
    return CHAT_URL_PATTERN.exec(url)?.[1];
  });

  ngOnInit(): void {
    if (this.role() !== 'user' || this.historyLoaded()) {
      return;
    }
    this.historyLoaded.set(true);
    this.chatsLoading.set(true);
    this.chatService
      .list()
      .pipe(
        finalize(() => this.chatsLoading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (chats) => {
          this.chatsError.set(false);
          this.chats.set(chats.map(toHistoryItem));
        },
        error: () => {
          this.chatsError.set(true);
          this.chats.set([]);
        }
      });
  }

  openChat(chatId: string): void {
    void this.router.navigate(['/chats', chatId]);
  }

  logout(): void {
    this.isLoggingOut.set(true);
    this.auth.logout().subscribe({
      next: () => {
        this.isLoggingOut.set(false);
        this.profile.clear();
        this.notifications.info('Вы вышли из аккаунта');
        this.router.navigate(['/login']);
      },
      error: (err: { error?: { detail?: string; message?: string }; message?: string }) => {
        this.isLoggingOut.set(false);
        const reason = err.error?.detail ?? err.error?.message ?? err.message ?? 'Ошибка сервера';
        this.notifications.error('Не удалось выйти: ' + reason);
      }
    });
  }

  private static readonly STORAGE_KEY = 'sidebar-collapsed';

  readonly collapsed = signal(this.readCollapsed());

  private readCollapsed(): boolean {
    if (!Sidebar.isStorageAvailable()) {
      return false;
    }
    return localStorage.getItem(Sidebar.STORAGE_KEY) === 'true';
  }

  private writeCollapsed(value: boolean): void {
    if (!Sidebar.isStorageAvailable()) {
      return;
    }
    localStorage.setItem(Sidebar.STORAGE_KEY, String(value));
  }

  private static isStorageAvailable(): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage !== null;
    } catch {
      return false;
    }
  }

  toggleCollapsed(): void {
    this.collapsed.update((collapsed) => {
      const next = !collapsed;
      this.writeCollapsed(next);
      return next;
    });
  }
}

import { Component, computed, inject, input, signal } from '@angular/core';
import type { NavItem, Role } from './sidebar.config';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideLogOut,
  LucidePanelLeftClose,
  LucidePanelLeftOpen,
  LucidePlus
} from '@lucide/angular';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ProfileService } from '../../../core/services/profile.service';

@Component({
  selector: 'app-sidebar',
  imports: [
    LucideDynamicIcon,
    RouterLink,
    RouterLinkActive,
    LucidePlus,
    LucidePanelLeftClose,
    LucidePanelLeftOpen,
    LucideLogOut
  ],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  host: {
    '[class.sidebar--collapsed]': 'collapsed()'
  }
})
export class Sidebar {
  readonly navItems = input<NavItem[]>([]);
  readonly role = input<Role>();

  private readonly auth = inject(AuthService);
  private readonly profile = inject(ProfileService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  readonly user = this.profile.user;
  readonly displayName = computed(() => {
    const user = this.user();
    if (!user) {
      return '';
    }
    const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    return name || user.username;
  });
  readonly isLoggingOut = signal(false);

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

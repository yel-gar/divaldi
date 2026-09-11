import {
  AfterViewInit,
  Component,
  ElementRef,
  computed,
  input,
  signal,
  viewChildren
} from '@angular/core';
import type { NavItem, Role } from './sidebar.config';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideDynamicIcon,
  LucidePanelLeftClose,
  LucidePanelLeftOpen,
  LucidePlus
} from '@lucide/angular';

@Component({
  selector: 'app-sidebar',
  imports: [
    LucideDynamicIcon,
    RouterLink,
    RouterLinkActive,
    LucidePlus,
    LucidePanelLeftClose,
    LucidePanelLeftOpen
  ],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  host: {
    '[class.sidebar--collapsed]': 'collapsed()'
  }
})
export class Sidebar implements AfterViewInit {
  readonly navItems = input<NavItem[]>([]);
  readonly role = input<Role>();

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

  private readonly tabStopIndex = signal(0);
  private readonly navLinks = viewChildren<ElementRef<HTMLAnchorElement>>('navLink');

  readonly tabStop = computed(() => {
    const lastIndex = Math.max(0, this.navItems().length - 1);
    return Math.min(Math.max(this.tabStopIndex(), 0), lastIndex);
  });

  ngAfterViewInit(): void {
    const activeIndex = this.navLinks().findIndex(
      (link) => link.nativeElement.getAttribute('aria-current') === 'page'
    );
    if (activeIndex >= 0) {
      this.tabStopIndex.set(activeIndex);
    }
  }

  onItemFocus(index: number): void {
    this.tabStopIndex.set(index);
  }

  onActiveChange(isActive: boolean, index: number): void {
    if (isActive) {
      this.tabStopIndex.set(index);
    }
  }

  onListKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        this.moveFocus(event, this.tabStop() + 1);
        break;
      case 'ArrowUp':
        this.moveFocus(event, this.tabStop() - 1);
        break;
      case 'Home':
        this.moveFocus(event, 0);
        break;
      case 'End':
        this.moveFocus(event, this.navItems().length - 1);
        break;
    }
  }

  private moveFocus(event: KeyboardEvent, target: number): void {
    event.preventDefault();
    const count = this.navLinks().length;
    if (count === 0) {
      return;
    }
    const next = ((target % count) + count) % count;
    this.tabStopIndex.set(next);
    this.navLinks()[next]?.nativeElement.focus();
  }
}

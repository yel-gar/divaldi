import { Component, input } from '@angular/core';
import type { NavItem, Role } from './sidebar.config';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideDynamicIcon, LucidePlus } from '@lucide/angular';

@Component({
  selector: 'app-sidebar',
  imports: [LucideDynamicIcon, RouterLink, RouterLinkActive, LucidePlus],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss'
})
export class Sidebar {
  readonly navItems = input<NavItem[]>([]);
  readonly role = input<Role>();
}

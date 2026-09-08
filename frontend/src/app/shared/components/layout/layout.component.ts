import { Component, input } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from '../sidebar/sidebar.component';
import type { NavItem, Role } from '../sidebar/sidebar.config';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, Sidebar],
  templateUrl: './layout.html',
  styleUrl: './layout.scss'
})
export class Layout {
  readonly navItems = input<NavItem[]>([]);
  readonly role = input<Role>();
}

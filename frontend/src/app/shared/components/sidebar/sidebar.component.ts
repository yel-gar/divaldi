import { Component, inject, type OnInit } from '@angular/core';
import type { NavItem } from './sidebar.config';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';

@Component({
  selector: 'app-sidebar',
  imports: [LucideDynamicIcon, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss'
})
export class Sidebar implements OnInit {
  navItems: NavItem[] = [];

  private route = inject(ActivatedRoute);

  ngOnInit() {
    this.navItems =
      this.route.snapshot.data['navItems'] || this.route.parent?.snapshot.data['navItems'] || [];
  }
}

import { Component } from '@angular/core';
import { LucideChevronRight, LucideChevronsUpDown } from '@lucide/angular';

@Component({
  selector: 'app-history-page',
  imports: [LucideChevronsUpDown, LucideChevronRight],
  templateUrl: './history-page.html',
  styleUrl: './history-page.scss'
})
export class HistoryPage {}

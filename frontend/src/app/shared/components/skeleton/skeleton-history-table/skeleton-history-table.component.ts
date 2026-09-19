import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-skeleton-history-table',
  standalone: true,
  imports: [],
  template: `
    <div class="skeleton-item skeleton-item--history-table">
      <div class="skeleton-item skeleton-item--history-table-head">
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
      </div>
      @for (row of itemArray(); track $index) {
        <div class="skeleton-item skeleton-item--history-table-row">
          <div class="skeleton-item skeleton-item--rect"></div>
          <div class="skeleton-item skeleton-item--rect"></div>
          <div class="skeleton-item skeleton-item--rect"></div>
          <div class="skeleton-item skeleton-item--rect"></div>
        </div>
      }
    </div>
  `,
  styles: [':host { display: block; width: 100%; }'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SkeletonHistoryTableComponent {
  readonly rows = input(1);
  readonly itemArray = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}

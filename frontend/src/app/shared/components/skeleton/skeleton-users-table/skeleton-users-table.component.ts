import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-skeleton-users-table',
  standalone: true,
  imports: [],
  template: `
    <div class="skeleton-item skeleton-item--users-table">
      @for (row of itemArray(); track $index) {
        <div class="skeleton-item skeleton-item--users-table-row">
          <div class="skeleton-item skeleton-item--rect"></div>
          <div class="skeleton-item skeleton-item--rect"></div>
          <div class="skeleton-item skeleton-item--rect"></div>
        </div>
      }
    </div>
  `,
  styleUrl: './skeleton-users-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SkeletonUsersTableComponent {
  readonly rows = input(1);
  readonly itemArray = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-skeleton-users-table',
  standalone: true,
  imports: [],
  template: `
    <div class="skeleton-item skeleton-item--users-table">
      <div class="skeleton-item skeleton-item--users-table-head">
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
      </div>
      @for (row of itemArray(); track $index) {
        <div class="skeleton-item skeleton-item--users-table-row">
          <div class="skeleton-item skeleton-item--users-table-user">
            <div class="skeleton-item skeleton-item--circle"></div>
            <div class="skeleton-item skeleton-item--rect"></div>
          </div>
          <div class="skeleton-item skeleton-item--users-table-name">
            <div class="skeleton-item skeleton-item--rect"></div>
          </div>
          <div class="skeleton-item skeleton-item--rect skeleton-item--users-table-badge"></div>
          <div class="skeleton-item skeleton-item--users-table-actions">
            <div class="skeleton-item skeleton-item--rect"></div>
            <div class="skeleton-item skeleton-item--rect"></div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [':host { display: block; width: 100%; }'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SkeletonUsersTableComponent {
  readonly rows = input(1);
  readonly itemArray = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}

import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-skeleton-dnd-item',
  standalone: true,
  imports: [],
  template: `
    <div class="skeleton-item skeleton-item--dnd-item">
      <div class="skeleton-item skeleton-item--dnd-icon skeleton-item--circle"></div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SkeletonDnDItemComponent {}

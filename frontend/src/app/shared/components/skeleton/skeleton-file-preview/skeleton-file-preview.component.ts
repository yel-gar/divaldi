import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-skeleton-file-preview',
  standalone: true,
  imports: [],
  template: `
    <div class="skeleton-item skeleton-item--file-preview">
      <div class="skeleton-item skeleton-item--file-preview-page">
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
        <div class="skeleton-item skeleton-item--rect"></div>
      </div>
    </div>
  `,
  styles: [':host { display: block; width: 100%; }'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SkeletonFilePreviewComponent {}

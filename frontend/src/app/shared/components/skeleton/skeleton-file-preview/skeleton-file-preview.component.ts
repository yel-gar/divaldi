import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-skeleton-file-preview',
  standalone: true,
  imports: [],
  template: `
    <div class="skeleton-item skeleton-item--file-preview">
      <div class="skeleton-item skeleton-item--file-preview-icon skeleton-item--circle"></div>
      <div class="skeleton-item skeleton-item--rect"></div>
    </div>
  `,
  styleUrl: './skeleton-file-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SkeletonFilePreviewComponent {}

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideHammer } from '@lucide/angular';

@Component({
  selector: 'app-section-placeholder',
  imports: [LucideHammer],
  templateUrl: './section-placeholder.component.html',
  styleUrl: './section-placeholder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SectionPlaceholder {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
}

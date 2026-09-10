import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-progress-bar',
  imports: [],
  templateUrl: './progress-bar.component.html',
  styleUrl: './progress-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'progressbar',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'clampedValue()',
    'aria-valuemin': '0',
    'aria-valuemax': '100'
  }
})
export class ProgressBarComponent {
  readonly value = input.required<number>();
  readonly label = input<string | undefined>(undefined);

  readonly clampedValue = computed(() => Math.min(100, Math.max(0, this.value())));
}

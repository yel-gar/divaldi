import { ChangeDetectionStrategy, Component, computed, input, type Signal } from '@angular/core';

const SKELETON_BASE = 'var(--color-skeleton-base)';
const SKELETON_SHIMMER = 'var(--color-skeleton-shimmer)';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [],
  template: `<ng-container></ng-container>`,
  styleUrl: './skeleton.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-busy': 'true',
    'aria-hidden': 'true',
    class: 'skeleton-item',
    style: 'display: block;'
  }
})
export class SkeletonComponent {
  readonly variant = input<'text' | 'circle' | 'rect'>('text');
  readonly width = input<string>();
  readonly height = input<string>();
  readonly borderRadius = input<string>();
  readonly count = input(1);
  readonly animated = input(true);
  readonly gap = input('0.75rem');

  readonly items: Signal<number[]> = computed(() => {
    const c = this.count();
    return Array.from({ length: Math.max(1, c) }, (_, i) => i);
  });

  readonly hostStyle = computed(() => {
    const w = this.resolveWidth();
    const animated = this.animated();
    const gapValue = this.gap();

    const isMulti = this.count() > 1;
    const layout = isMulti ? 'flex' : 'block';

    let animationValue = 'none';
    if (animated) {
      animationValue = 'skeleton-shimmer 2s ease-out infinite';
    }

    return {
      display: layout,
      gap: isMulti && animated ? gapValue : '0',
      animation: animationValue,
      width: w
    };
  });

  readonly hostClass = computed(() => {
    const variant = this.variant();
    const animated = this.animated();

    let cls = 'skeleton-item';
    if (variant === 'circle') cls += ' skeleton-item--circle';
    if (variant === 'rect') cls += ' skeleton-item--rect';
    if (!animated) cls += ' skeleton-item--static';
    return cls;
  });

  private resolveWidth(): Signal<string> {
    return computed(() => {
      const w = this.width();
      if (w) return w;

      const variant = this.variant();
      if (variant === 'circle') return '40px';
      return '100%';
    });
  }

  readonly resolvedWidth = this.resolveWidth();

  readonly resolvedHeight = computed(() => {
    const h = this.height();
    if (h) return h;

    const variant = this.variant();
    if (variant === 'circle') return this.resolvedWidth();
    if (variant === 'rect') return '100px';
    return '1em';
  });

  readonly resolvedBorderRadius = computed(() => {
    const override = this.borderRadius();
    if (override) return override;

    const variant = this.variant();
    if (variant === 'circle') return '50%';
    if (variant === 'rect') return '8px';
    return '4px';
  });

  readonly resolvedGap = computed(() => {
    const g = this.gap();
    return g;
  });

  readonly shimmerGradient = computed(() => {
    return `linear-gradient(100deg, ${SKELETON_BASE} 0%, ${SKELETON_BASE} 50%, ${SKELETON_SHIMMER} 60%, ${SKELETON_BASE} 70%)`;
  });
}

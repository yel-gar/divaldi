import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-skeleton-chat-list',
  standalone: true,
  imports: [],
  template: `
    <div class="skeleton-item skeleton-item--chat-list">
      @for (item of itemArray(); track $index) {
        <div class="skeleton-item skeleton-item--chat-list-item">
          <div class="skeleton-item skeleton-item--circle"></div>
          <div class="skeleton-item skeleton-item--rect"></div>
        </div>
      }
    </div>
  `,
  styles: [':host { display: block; width: 100%; }'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SkeletonChatListComponent {
  readonly items = input(1);
  readonly itemArray = computed(() => Array.from({ length: this.items() }, (_, i) => i));
}

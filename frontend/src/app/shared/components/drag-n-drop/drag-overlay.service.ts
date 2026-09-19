import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DragOverlayService {
  readonly isVisible = signal(false);

  show(): void {
    this.isVisible.set(true);
  }

  hide(): void {
    this.isVisible.set(false);
  }
}

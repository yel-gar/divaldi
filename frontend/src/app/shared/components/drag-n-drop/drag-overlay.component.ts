import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  output
} from '@angular/core';
import { LucideCloudUpload } from '@lucide/angular';
import { DragOverlayService } from './drag-overlay.service';

@Component({
  selector: 'app-drag-overlay',
  imports: [LucideCloudUpload],
  templateUrl: './drag-overlay.component.html',
  styleUrl: './drag-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:dragenter)': 'onDragEnter($event)',
    '(document:dragover)': 'onDragOver($event)',
    '(document:dragleave)': 'onDragLeave($event)',
    '(document:drop)': 'onDrop($event)'
  }
})
export class DragOverlayComponent implements AfterViewInit {
  readonly filesDropped = output<File[]>();

  readonly overlay = inject(DragOverlayService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private dragDepth = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.dragDepth = 0;
      this.overlay.hide();
    });
  }

  ngAfterViewInit(): void {
    document.body.appendChild(this.host.nativeElement);
  }

  onDragEnter(event: DragEvent): void {
    if (!this.isFilesDrag(event)) {
      return;
    }
    event.preventDefault();
    this.dragDepth++;
    this.overlay.show();
  }

  onDragOver(event: DragEvent): void {
    if (!this.isFilesDrag(event)) {
      return;
    }
    event.preventDefault();
  }

  onDragLeave(event: DragEvent): void {
    if (!this.isFilesDrag(event) || this.dragDepth === 0) {
      return;
    }
    this.dragDepth--;
    if (this.dragDepth === 0) {
      this.overlay.hide();
    }
  }

  onDrop(event: DragEvent): void {
    if (!this.isFilesDrag(event)) {
      return;
    }
    event.preventDefault();
    this.dragDepth = 0;
    this.overlay.hide();
    this.filesDropped.emit(Array.from(event.dataTransfer?.files ?? []));
  }

  private isFilesDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }
}

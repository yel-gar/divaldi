import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  output,
  signal
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  LucideCheck,
  LucideChevronDown,
  LucideCircleAlert,
  LucideClock3,
  LucideCloudUpload,
  LucideDynamicIcon,
  LucideEye,
  LucideLoaderCircle,
  LucideRotateCcw,
  LucideTrash2
} from '@lucide/angular';
import type { LucideIconData } from '@lucide/angular';
import {
  ACCEPTED_EXTENSIONS,
  MAX_CONCURRENT_UPLOADS,
  MAX_FILE_SIZE,
  UploadItem,
  UploadSpeedSample,
  UploadState,
  VISIBLE_FILES_LIMIT
} from '../../../core/models/models';
import { formatBytes, formatEta, formatSpeed, getFileExtension } from '../../utils/upload-format';
import { createId } from '../../utils/create-id';
import { previewKindFor } from './file-preview.model';
import { FilePreviewComponent } from './file-preview.component';
import { ProgressBarComponent } from '../progress-bar/progress-bar.component';
import { UploadSimulatorService } from '../../../core/services/upload-simulator.service';
import {
  FILE_TYPE_CAD,
  FILE_TYPE_EXCEL,
  FILE_TYPE_IMAGE,
  FILE_TYPE_PDF,
  FILE_TYPE_WORD
} from './file-type-icons';

interface FileTypeStyle {
  readonly icon: LucideIconData;
  readonly color: string;
}

const FILE_TYPE_STYLES: Record<string, FileTypeStyle> = {
  '.pdf': { icon: FILE_TYPE_PDF, color: 'var(--color-danger)' },
  '.doc': { icon: FILE_TYPE_WORD, color: 'var(--color-main)' },
  '.docx': { icon: FILE_TYPE_WORD, color: 'var(--color-main)' },
  '.xls': { icon: FILE_TYPE_EXCEL, color: 'var(--color-success)' },
  '.xlsx': { icon: FILE_TYPE_EXCEL, color: 'var(--color-success)' },
  '.png': { icon: FILE_TYPE_IMAGE, color: 'var(--color-warning)' },
  '.jpg': { icon: FILE_TYPE_IMAGE, color: 'var(--color-warning)' },
  '.jpeg': { icon: FILE_TYPE_IMAGE, color: 'var(--color-warning)' },
  '.dwg': { icon: FILE_TYPE_CAD, color: 'var(--color-cad)' },
  '.dxf': { icon: FILE_TYPE_CAD, color: 'var(--color-cad)' }
};

const UNKNOWN_FILE_TYPE: FileTypeStyle = {
  icon: FILE_TYPE_IMAGE,
  color: 'var(--color-gray)'
};

const SPEED_SAMPLE_WINDOW = 5;

const SPEED_STALE_AFTER_SECONDS = 4;

const SPEED_TICK_MS = 1000;

const PROGRESS_CIRCLE_RADIUS = 20;

@Component({
  selector: 'app-drag-n-drop',
  imports: [
    FilePreviewComponent,
    ProgressBarComponent,
    LucideCheck,
    LucideChevronDown,
    LucideCircleAlert,
    LucideClock3,
    LucideCloudUpload,
    LucideDynamicIcon,
    LucideEye,
    LucideLoaderCircle,
    LucideRotateCcw,
    LucideTrash2
  ],
  templateUrl: './drag-n-drop.component.html',
  styleUrl: './drag-n-drop.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DragNDropComponent implements OnDestroy {
  readonly acceptAttr = ACCEPTED_EXTENSIONS.join(',');
  readonly visibleLimit = VISIBLE_FILES_LIMIT;
  readonly circumference = 2 * Math.PI * PROGRESS_CIRCLE_RADIUS;

  readonly state = signal<UploadState>('idle');
  readonly items = signal<UploadItem[]>([]);
  readonly isDragOver = signal(false);
  readonly isCollapsed = signal(false);
  readonly showAllFiles = signal(false);
  readonly bytesPerSecond = signal(0);
  readonly etaSeconds = signal(Infinity);
  readonly previewItem = signal<UploadItem | null>(null);

  readonly filesChange = output<File[]>();

  readonly previewKindFor = previewKindFor;

  private readonly simulator = inject(UploadSimulatorService);

  private readonly activeUploads = new Map<string, Subscription>();
  private readonly speedSamples: UploadSpeedSample[] = [];
  private speedTicker: ReturnType<typeof setInterval> | null = null;

  readonly totalBytes = computed(() => this.items().reduce((sum, item) => sum + item.size, 0));

  readonly uploadedBytes = computed(() =>
    this.items().reduce((sum, item) => sum + item.uploaded, 0)
  );

  readonly doneFiles = computed(() => this.items().filter((item) => item.status === 'done').length);

  readonly progressPercent = computed(() => {
    const total = this.totalBytes();
    return total === 0 ? 0 : Math.min(100, Math.round((this.uploadedBytes() / total) * 100));
  });

  readonly visibleItems = computed(() =>
    this.showAllFiles() ? this.items() : this.items().slice(0, this.visibleLimit)
  );

  readonly listItems = computed(() =>
    this.state() === 'completed' ? this.items() : this.visibleItems()
  );

  readonly uploadedLabel = computed(() => formatBytes(this.uploadedBytes()));
  readonly totalLabel = computed(() => formatBytes(this.totalBytes()));
  readonly speedLabel = computed(() => formatSpeed(this.bytesPerSecond()));
  readonly etaLabel = computed(() => formatEta(this.etaSeconds()));

  ngOnDestroy(): void {
    this.stopSpeedTicker();
    this.activeUploads.forEach((subscription) => subscription.unsubscribe());
    this.activeUploads.clear();
  }

  openFilePicker(input: HTMLInputElement): void {
    input.click();
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.enqueueFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    const zone = event.currentTarget as HTMLElement;
    if (!zone.contains(event.relatedTarget as Node)) {
      this.isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    this.enqueueFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  toggleCollapse(): void {
    this.isCollapsed.update((collapsed) => !collapsed);
  }

  toggleShowAll(): void {
    this.showAllFiles.update((showAll) => !showAll);
  }

  removeItem(id: string): void {
    this.activeUploads.get(id)?.unsubscribe();
    this.activeUploads.delete(id);
    if (this.previewItem()?.id === id) {
      this.previewItem.set(null);
    }
    this.items.update((list) => list.filter((item) => item.id !== id));
    this.emitFiles();
    if (this.items().length === 0) {
      if (this.activeUploads.size === 0) {
        this.resetToIdle();
      }
      return;
    }
    this.refreshSpeed();
    if (this.state() === 'uploading') {
      this.pumpQueue();
    }
  }

  retryItem(id: string): void {
    const item = this.items().find((candidate) => candidate.id === id);
    if (!item || item.status !== 'error' || this.activeUploads.has(id)) {
      return;
    }
    this.patchItem(id, { status: 'queued', uploaded: 0 });
    this.resetForRetry();
    this.startSpeedTicker();
    this.pumpQueue();
  }

  openPreview(item: UploadItem): void {
    this.previewItem.set(item);
  }

  closePreview(): void {
    this.previewItem.set(null);
  }

  iconFor(item: UploadItem): LucideIconData {
    return this.typeStyleFor(item).icon;
  }

  colorFor(item: UploadItem): string {
    return this.typeStyleFor(item).color;
  }

  private typeStyleFor(item: UploadItem): FileTypeStyle {
    return FILE_TYPE_STYLES[item.extension] ?? UNKNOWN_FILE_TYPE;
  }

  private emitFiles(): void {
    this.filesChange.emit(this.items().map((item) => item.file));
  }

  percentOf(item: UploadItem): number {
    if (item.size === 0) {
      return 100;
    }
    return Math.min(100, Math.round((item.uploaded / item.size) * 100));
  }

  sizeLabel(item: UploadItem): string {
    if (item.status === 'uploading') {
      return `${formatBytes(item.uploaded)} из ${formatBytes(item.size)}`;
    }
    return formatBytes(item.size);
  }

  statusLabel(item: UploadItem): string {
    switch (item.status) {
      case 'done':
        return 'Готово';
      case 'uploading':
        return 'Загружается';
      case 'error':
        return 'Ошибка';
      default:
        return 'В очереди';
    }
  }

  private enqueueFiles(files: File[]): void {
    const seen = new Set(this.items().map((item) => item.file.name + ':' + item.file.size));
    const accepted = files.filter((file) => {
      const key = file.name + ':' + file.size;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return (
        ACCEPTED_EXTENSIONS.includes(
          getFileExtension(file.name) as (typeof ACCEPTED_EXTENSIONS)[number]
        ) && file.size <= MAX_FILE_SIZE
      );
    });
    if (accepted.length === 0) {
      return;
    }
    const newItems: UploadItem[] = accepted.map((file) => ({
      id: createId(),
      name: file.name,
      size: file.size,
      extension: getFileExtension(file.name),
      file,
      status: 'queued',
      uploaded: 0
    }));
    this.items.update((list) => [...list, ...newItems]);
    this.emitFiles();
    this.state.set('uploading');
    this.isCollapsed.set(false);
    this.speedSamples.length = 0;
    this.startSpeedTicker();
    this.pumpQueue();
  }

  private pumpQueue(): void {
    for (const item of this.items()) {
      if (this.activeUploads.size >= MAX_CONCURRENT_UPLOADS) {
        return;
      }
      if (item.status === 'queued') {
        this.startItem(item);
      }
    }
  }

  private startItem(item: UploadItem): void {
    this.patchItem(item.id, { status: 'uploading' });
    const subscription = this.simulator
      .upload(item, {
        onProgress: (uploaded) => this.patchItem(item.id, { uploaded })
      })
      .subscribe({
        next: (uploaded) => this.patchItem(item.id, { uploaded }),
        complete: () => this.finishItem(item.id),
        error: () => this.failItem(item.id)
      });
    if (this.items().find((candidate) => candidate.id === item.id)?.status === 'uploading') {
      this.activeUploads.set(item.id, subscription);
    }
  }

  private finishItem(id: string): void {
    const item = this.items().find((candidate) => candidate.id === id);
    if (!item || item.status === 'done' || item.status === 'error') {
      return;
    }
    this.activeUploads.delete(id);
    this.patchItem(id, { status: 'done', uploaded: item.size });
    if (this.doneFiles() === this.items().length) {
      this.state.set('completed');
      this.stopSpeedTicker();
      return;
    }
    this.pumpQueue();
  }

  private failItem(id: string): void {
    const item = this.items().find((candidate) => candidate.id === id);
    if (!item || item.status === 'done') {
      return;
    }
    this.activeUploads.delete(id);
    this.patchItem(id, { status: 'error', uploaded: 0 });
    if (this.state() === 'uploading') {
      this.pumpQueue();
    }
  }

  private patchItem(id: string, patch: Partial<Pick<UploadItem, 'status' | 'uploaded'>>): void {
    this.items.update((list) =>
      list.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
    this.refreshSpeed();
  }

  private refreshSpeed(): void {
    const uploaded = this.uploadedBytes();
    const last = this.speedSamples[this.speedSamples.length - 1];
    if (last && last.bytes === uploaded) {
      if ((Date.now() - last.time) / 1000 > SPEED_STALE_AFTER_SECONDS) {
        this.speedSamples.length = 0;
        this.publishSpeed(uploaded, 0);
      }
      return;
    }
    this.speedSamples.push({ time: Date.now(), bytes: uploaded });
    if (this.speedSamples.length > SPEED_SAMPLE_WINDOW) {
      this.speedSamples.shift();
    }
    this.publishSpeed(uploaded, this.currentSpeed());
  }

  private publishSpeed(uploaded: number, speed: number): void {
    this.bytesPerSecond.set(speed);
    this.etaSeconds.set(speed > 0 ? (this.totalBytes() - uploaded) / speed : Infinity);
  }

  private startSpeedTicker(): void {
    if (this.speedTicker !== null) {
      return;
    }
    this.speedTicker = setInterval(() => {
      if (this.state() !== 'uploading') {
        this.stopSpeedTicker();
        return;
      }
      const last = this.speedSamples[this.speedSamples.length - 1];
      if (last && (Date.now() - last.time) / 1000 > SPEED_STALE_AFTER_SECONDS) {
        this.speedSamples.length = 0;
        this.publishSpeed(this.uploadedBytes(), 0);
      }
    }, SPEED_TICK_MS);
  }

  private stopSpeedTicker(): void {
    if (this.speedTicker !== null) {
      clearInterval(this.speedTicker);
      this.speedTicker = null;
    }
  }

  private currentSpeed(): number {
    const samples = this.speedSamples;
    if (samples.length < 2) {
      return 0;
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsedSeconds = (last.time - first.time) / 1000;
    if (elapsedSeconds <= 0) {
      return 0;
    }
    return Math.max(0, (last.bytes - first.bytes) / elapsedSeconds);
  }

  private resetForRetry(): void {
    this.speedSamples.length = 0;
    this.bytesPerSecond.set(0);
    this.etaSeconds.set(Infinity);
  }

  private resetToIdle(): void {
    this.state.set('idle');
    this.items.set([]);
    this.emitFiles();
    this.showAllFiles.set(false);
    this.isCollapsed.set(false);
    this.previewItem.set(null);
    this.resetForRetry();
    this.stopSpeedTicker();
  }
}

import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import { UploadItem } from './upload.model';

export interface UploadSimulatorTiming {
  readonly minChunkMs: number;
  readonly maxChunkMs: number;
}

export interface UploadSimulatorOptions {
  readonly onProgress?: (uploadedBytes: number) => void;
}

const DEFAULT_UPLOAD_TIMING: UploadSimulatorTiming = {
  minChunkMs: 400,
  maxChunkMs: 1200
};

export const UPLOAD_SIMULATOR_TIMING = new InjectionToken<UploadSimulatorTiming>(
  'UPLOAD_SIMULATOR_TIMING',
  {
    providedIn: 'root',
    factory: () => DEFAULT_UPLOAD_TIMING
  }
);

const MIN_CHUNK_BYTES = 64 * 1024;
const MAX_CHUNK_BYTES_RATIO = 0.18;

interface ChunkTimer {
  readonly subscription: Subscription;
}

@Injectable({ providedIn: 'root' })
export class UploadSimulator {
  private readonly timing = inject(UPLOAD_SIMULATOR_TIMING);

  upload(item: UploadItem, options: UploadSimulatorOptions = {}): Observable<number> {
    return new Observable<number>((observer) => {
      let disposed = false;
      let current: ChunkTimer | null = null;
      let uploaded = Math.min(item.uploaded, item.size);

      const scheduleChunk = (): void => {
        if (disposed) {
          return;
        }
        if (uploaded >= item.size) {
          observer.complete();
          return;
        }
        const chunkBytes = this.chunkSize(item.size);
        const { minChunkMs, maxChunkMs } = this.timing;
        const delay = minChunkMs + Math.random() * (maxChunkMs - minChunkMs);
        const timer = new Subject<void>();
        const subscription = timer.subscribe({
          next: () => {
            if (disposed) {
              return;
            }
            uploaded = Math.min(uploaded + chunkBytes, item.size);
            observer.next(uploaded);
            options.onProgress?.(uploaded);
            scheduleChunk();
          }
        });
        current = { subscription };
        this.setTimer(timer, delay);
      };

      scheduleChunk();

      return () => {
        disposed = true;
        current?.subscription.unsubscribe();
      };
    });
  }

  private setTimer(subject: Subject<void>, delay: number): void {
    setTimeout(() => subject.next(), delay);
  }

  private chunkSize(totalSize: number): number {
    const ratioChunk = totalSize * MAX_CHUNK_BYTES_RATIO;
    return Math.max(MIN_CHUNK_BYTES, Math.min(ratioChunk, totalSize));
  }
}

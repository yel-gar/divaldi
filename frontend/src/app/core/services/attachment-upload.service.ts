import { Injectable, inject } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { mimeTypeFor } from '../../shared/components/drag-n-drop/file-preview.model';
import { UploadItem } from '../models/models';
import { ChatService } from './chat.service';

export interface AttachmentUploadOptions {
  readonly onProgress?: (uploadedBytes: number) => void;
}

const STATUS_POLL_INTERVAL_MS = 2000;
const STATUS_POLL_LIMIT = 150;

@Injectable({ providedIn: 'root' })
export class AttachmentUploadService {
  private readonly chatService = inject(ChatService);

  upload(
    item: UploadItem,
    sessionId: string,
    options: AttachmentUploadOptions = {}
  ): Observable<number> {
    return new Observable<number>((observer) => {
      let disposed = false;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let pollCount = 0;
      const request = new XMLHttpRequest();
      const innerSubscriptions = new Set<Subscription>();

      const subscribeInner = <T>(source: Observable<T>, onNext: (value: T) => void): void => {
        const subscription = source.subscribe({
          next: onNext,
          error: (err) => {
            innerSubscriptions.delete(subscription);
            if (!disposed) {
              observer.error(err);
            }
          }
        });
        innerSubscriptions.add(subscription);
      };

      const pollStatus = (attachmentId: number): void => {
        if (disposed) {
          return;
        }
        pollCount++;
        if (pollCount > STATUS_POLL_LIMIT) {
          observer.error(new Error('Превышено время ожидания обработки файла'));
          return;
        }
        subscribeInner(this.chatService.attachmentStatus(sessionId, attachmentId), ({ status }) => {
          if (disposed) {
            return;
          }
          if (status === 'completed') {
            observer.complete();
            return;
          }
          if (status === 'error') {
            observer.error(new Error('Не удалось обработать файл'));
            return;
          }
          pollTimer = setTimeout(() => pollStatus(attachmentId), STATUS_POLL_INTERVAL_MS);
        });
      };

      subscribeInner(
        this.chatService.requestUpload(sessionId, {
          content_type: mimeTypeFor(item.extension),
          file_size: item.size,
          filename: item.name
        }),
        ({ attachment_id, params }) => {
          if (disposed) {
            return;
          }
          const form = new FormData();
          for (const [key, value] of Object.entries(params.fields)) {
            form.append(key, value);
          }
          form.append('file', item.file);

          request.open('POST', params.url);
          request.upload.onprogress = (event) => {
            if (disposed || !event.lengthComputable) {
              return;
            }
            const uploaded = Math.min(event.loaded, item.size);
            observer.next(uploaded);
            options.onProgress?.(uploaded);
          };
          request.onload = () => {
            if (disposed) {
              return;
            }
            if (request.status < 200 || request.status >= 300) {
              observer.error(
                new Error(`Не удалось загрузить файл в хранилище (${request.status})`)
              );
              return;
            }
            observer.next(item.size);
            options.onProgress?.(item.size);
            subscribeInner(this.chatService.confirmUploaded(sessionId, attachment_id), () => {
              if (disposed) {
                return;
              }
              pollTimer = setTimeout(() => pollStatus(attachment_id), STATUS_POLL_INTERVAL_MS);
            });
          };
          request.onerror = () => {
            if (!disposed) {
              observer.error(new Error('Не удалось загрузить файл в хранилище'));
            }
          };
          request.send(form);
        }
      );

      return () => {
        disposed = true;
        if (pollTimer !== null) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        request.abort();
        innerSubscriptions.forEach((subscription) => subscription.unsubscribe());
        innerSubscriptions.clear();
      };
    });
  }
}

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { mimeTypeFor } from '../../shared/components/drag-n-drop/file-preview.model';
import { UploadItem } from '../models/models';
import { ChatService } from './chat.service';

export interface AttachmentUploadOptions {
  readonly onProgress?: (uploadedBytes: number) => void;
}

const STATUS_POLL_INTERVAL_MS = 2000;

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
      const request = new XMLHttpRequest();

      const pollStatus = (attachmentId: number): void => {
        if (disposed) {
          return;
        }
        this.chatService.attachmentStatus(sessionId, attachmentId).subscribe({
          next: ({ status }) => {
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
          },
          error: (err) => {
            if (!disposed) {
              observer.error(err);
            }
          }
        });
      };

      this.chatService
        .requestUpload(sessionId, {
          content_type: mimeTypeFor(item.extension),
          file_size: item.size,
          filename: item.name
        })
        .subscribe({
          next: ({ attachment_id, params }) => {
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
              this.chatService.confirmUploaded(sessionId, attachment_id).subscribe({
                next: () => {
                  if (disposed) {
                    return;
                  }
                  pollTimer = setTimeout(() => pollStatus(attachment_id), STATUS_POLL_INTERVAL_MS);
                },
                error: (err) => {
                  if (!disposed) {
                    observer.error(err);
                  }
                }
              });
            };
            request.onerror = () => {
              if (!disposed) {
                observer.error(new Error('Не удалось загрузить файл в хранилище'));
              }
            };
            request.send(form);
          },
          error: (err) => {
            if (!disposed) {
              observer.error(err);
            }
          }
        });

      return () => {
        disposed = true;
        if (pollTimer !== null) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        request.abort();
      };
    });
  }
}

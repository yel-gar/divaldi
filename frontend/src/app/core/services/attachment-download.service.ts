import { Injectable, inject } from '@angular/core';
import { Observable, from, switchMap } from 'rxjs';
import { ChatService } from './chat.service';

@Injectable({ providedIn: 'root' })
export class AttachmentDownloadService {
  private readonly chatService = inject(ChatService);

  fetchFile(sessionId: string, attachmentId: number): Observable<File> {
    return this.chatService.getAttachmentUrl(sessionId, attachmentId).pipe(
      switchMap(({ attachment_url, filename }) =>
        from(
          fetch(attachment_url, { cache: 'no-store' }).then(async (response) => {
            if (!response.ok) {
              throw new Error('Ссылка на файл недоступна — попробуйте ещё раз');
            }
            return new File([await response.blob()], filename);
          })
        )
      )
    );
  }

  save(file: File, filename: string): void {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url));
  }
}

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ChatAttachmentStatus,
  ChatAttachmentUrl,
  ChatCreated,
  ChatListQuery,
  ChatMessageApi,
  ChatResult,
  ChatUploadParams,
  MessageResponse,
  PaginatedResponse,
  UserChat
} from '../models/models';

/** Page size the chat list is requested with unless a caller asks for another. */
export const CHATS_PAGE_SIZE = 20;

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/chats`;

  readonly historyVersion = signal(0);

  create(): Observable<ChatCreated> {
    return this.http.post<ChatCreated>(`${this.baseUrl}/`, {}).pipe(tap(() => this.bumpHistory()));
  }

  list(query: ChatListQuery = {}): Observable<PaginatedResponse<UserChat>> {
    const params = new HttpParams()
      .set('page', query.page ?? 0)
      .set('items_per_page', query.itemsPerPage ?? CHATS_PAGE_SIZE)
      .set('sort', query.sort ?? 'date')
      .set('order', query.order ?? 'desc');

    return this.http.get<PaginatedResponse<UserChat>>(`${this.baseUrl}/`, { params });
  }

  messages(sessionId: string): Observable<ChatMessageApi[]> {
    return this.http.get<ChatMessageApi[]>(`${this.baseUrl}/${sessionId}`);
  }

  result(sessionId: string): Observable<ChatResult> {
    return this.http.get<ChatResult>(`${this.baseUrl}/${sessionId}/result`).pipe(
      tap((result) => {
        if (!result.running) {
          this.bumpHistory();
        }
      })
    );
  }

  send(sessionId: string, content: string): Observable<MessageResponse> {
    return this.http
      .post<MessageResponse>(`${this.baseUrl}/${sessionId}`, { content })
      .pipe(tap(() => this.bumpHistory()));
  }

  remove(sessionId: string): Observable<{ deleted: boolean }> {
    return this.http
      .delete<{ deleted: boolean }>(`${this.baseUrl}/${sessionId}`)
      .pipe(tap(() => this.bumpHistory()));
  }

  retry(sessionId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.baseUrl}/${sessionId}/retry`, {});
  }

  private bumpHistory(): void {
    this.historyVersion.update((version) => version + 1);
  }

  requestUpload(
    sessionId: string,
    data: { content_type: string; file_size: number; filename: string }
  ): Observable<ChatUploadParams> {
    return this.http.post<ChatUploadParams>(`${this.baseUrl}/${sessionId}/uploads`, data);
  }

  confirmUploaded(sessionId: string, attachmentId: number): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(
      `${this.baseUrl}/${sessionId}/uploads/${attachmentId}/uploaded`,
      {}
    );
  }

  attachmentStatus(
    sessionId: string,
    attachmentId: number
  ): Observable<{ status: ChatAttachmentStatus }> {
    return this.http.post<{ status: ChatAttachmentStatus }>(
      `${this.baseUrl}/${sessionId}/uploads/${attachmentId}/status`,
      {}
    );
  }

  getAttachmentUrl(sessionId: string, attachmentId: number): Observable<ChatAttachmentUrl> {
    return this.http.get<ChatAttachmentUrl>(
      `${this.baseUrl}/${sessionId}/attachments/${attachmentId}`
    );
  }
}

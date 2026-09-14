import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ChatAttachmentStatus,
  ChatAttachmentUrl,
  ChatCreated,
  ChatMessageApi,
  ChatResult,
  ChatUploadParams,
  UserChat
} from '../models/models';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/chats`;

  create(): Observable<ChatCreated> {
    return this.http.post<ChatCreated>(`${this.baseUrl}/`, {});
  }

  list(): Observable<UserChat[]> {
    return this.http.get<UserChat[]>(`${this.baseUrl}/`);
  }

  messages(sessionId: string): Observable<ChatMessageApi[]> {
    return this.http.get<ChatMessageApi[]>(`${this.baseUrl}/${sessionId}`);
  }

  result(sessionId: string): Observable<ChatResult> {
    return this.http.get<ChatResult>(`${this.baseUrl}/${sessionId}/result`);
  }

  send(sessionId: string, content: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/${sessionId}`, { content });
  }

  remove(sessionId: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.baseUrl}/${sessionId}`);
  }

  retry(sessionId: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/${sessionId}/retry`, {});
  }

  requestUpload(
    sessionId: string,
    data: { content_type: string; file_size: number; filename: string }
  ): Observable<ChatUploadParams> {
    return this.http.post<ChatUploadParams>(`${this.baseUrl}/${sessionId}/uploads`, data);
  }

  confirmUploaded(sessionId: string, attachmentId: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
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

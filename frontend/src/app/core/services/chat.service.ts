import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ChatCreated, ChatMessageApi, ChatResult, UserChat } from '../models/models';

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/chats`;

  create(content: string): Observable<ChatCreated> {
    return this.http.post<ChatCreated>(`${this.baseUrl}/`, { content });
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
}

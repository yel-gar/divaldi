import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Order, Message, Parameter, CreateOrderPayload } from '../models/models';

@Injectable({
  providedIn: 'root'
})
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/sessions`;

  createSession(payload: CreateOrderPayload): Observable<Order> {
    const form = new FormData();
    form.set('description', payload.description);
    form.set('projectType', payload.projectType);
    form.set('priority', payload.priority);
    for (const file of payload.files) {
      form.append('files', file, file.name);
    }
    return this.http.post<Order>(this.baseUrl, form);
  }

  getSession(id: string): Observable<Order> {
    return this.http.get<Order>(`${this.baseUrl}/${id}`);
  }

  sendMessage(sessionId: string, content: string): Observable<Message> {
    return this.http.post<Message>(`${this.baseUrl}/${sessionId}/messages`, { content });
  }

  getParams(sessionId: string): Observable<Parameter[]> {
    return this.http.get<Parameter[]>(`${this.baseUrl}/${sessionId}/params`);
  }

  downloadResult(sessionId: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${sessionId}/download`, { responseType: 'blob' });
  }
}

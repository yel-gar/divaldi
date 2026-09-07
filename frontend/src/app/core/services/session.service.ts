import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';
import { Order, Message, Parameter } from '../models/models';

@Injectable({
  providedIn: 'root'
})
export class SessionService {
  private readonly api = inject(ApiService);

  createSession(description: string): Promise<Order> {
    return this.api.post<Order>('/sessions', { description });
  }

  getSession(id: string): Promise<Order> {
    return this.api.get<Order>(`/sessions/${id}`);
  }

  sendMessage(sessionId: string, content: string): Promise<Message> {
    return this.api.post<Message>(`/sessions/${sessionId}/messages`, { content });
  }

  getParams(sessionId: string): Promise<Parameter[]> {
    return this.api.get<Parameter[]>(`/sessions/${sessionId}/params`);
  }

  downloadResult(sessionId: string): Promise<Blob> {
    return this.api.get<Blob>(`/sessions/${sessionId}/download`);
  }
}

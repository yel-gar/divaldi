import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ChatService } from './chat.service';
import { environment } from '../../../environments/environment';

const SESSION_ID = 'd0a3f1e2-0000-4000-8000-123456789abc';

describe('ChatService', () => {
  let service: ChatService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(ChatService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('creates a chat and returns the session id', () => {
    let result: { session_id: string } | undefined;

    service.create('Нужен расчёт фланца DN100').subscribe((created) => {
      result = created;
    });

    const req = http.expectOne(`${environment.apiUrl}/chats/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ content: 'Нужен расчёт фланца DN100' });
    req.flush({ session_id: SESSION_ID }, { status: 202, statusText: 'Accepted' });

    expect(result?.session_id).toBe(SESSION_ID);
  });

  it('loads chat messages', () => {
    let result: unknown;

    service.messages(SESSION_ID).subscribe((messages) => {
      result = messages;
    });

    const req = http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}`);
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        id: 1,
        role: 'user',
        content: 'Нужен расчёт фланца DN100',
        timestamp: '2026-09-12T12:18:35.689095Z'
      }
    ]);

    expect(result).toEqual([
      {
        id: 1,
        role: 'user',
        content: 'Нужен расчёт фланца DN100',
        timestamp: '2026-09-12T12:18:35.689095Z'
      }
    ]);
  });

  it('sends a message to the chat', () => {
    let result: { message: string } | undefined;

    service.send(SESSION_ID, 'Уточни толщину стенки').subscribe((response) => {
      result = response;
    });

    const req = http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ content: 'Уточни толщину стенки' });
    req.flush({ message: 'Message accepted' }, { status: 202, statusText: 'Accepted' });

    expect(result?.message).toBe('Message accepted');
  });
});

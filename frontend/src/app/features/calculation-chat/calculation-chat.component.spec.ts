import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { CalculationChatComponent } from './calculation-chat.component';
import { environment } from '../../../environments/environment';

const SESSION_ID = 'd0a3f1e2-0000-4000-8000-123456789abc';
const HISTORY_URL = `${environment.apiUrl}/chats/${SESSION_ID}`;
const RESULT_URL = `${environment.apiUrl}/chats/${SESSION_ID}/result`;

const USER_MESSAGES = [
  {
    id: 1,
    role: 'user',
    content: 'Проверка реального API: расчёт кронштейна из стали 3',
    timestamp: '2026-09-12T12:18:35.689095Z'
  },
  {
    id: 6,
    role: 'user',
    content: 'Проверка отправки на реальный бэкенд',
    timestamp: '2026-09-12T13:08:59.615770Z'
  },
  {
    id: 8,
    role: 'user',
    content: 'Привет! Посчитай стоимость изготовления фланца DN100',
    timestamp: '2026-09-12T13:16:33.090762Z'
  },
  {
    id: 20,
    role: 'user',
    content: 'Проверка анимации статуса',
    timestamp: '2026-09-12T14:00:52.321248Z'
  }
];

const ANSWERED_MESSAGES = [
  ...USER_MESSAGES,
  {
    id: 21,
    role: 'assistant',
    content: 'Ответ агента',
    timestamp: '2026-09-12T14:01:30.000000Z'
  }
];

describe('CalculationChat session resume', () => {
  let fixture: ComponentFixture<CalculationChatComponent>;
  let http: HttpTestingController;

  const openSession = (): void => {
    fixture = TestBed.createComponent(CalculationChatComponent);
    fixture.componentRef.setInput('id', SESSION_ID);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CalculationChatComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('does not wait for the agent when opening a session without an in-flight generation', () => {
    openSession();
    http.expectOne(HISTORY_URL).flush(USER_MESSAGES);
    fixture.detectChanges();

    const resultReq = http.expectOne(RESULT_URL);
    expect(resultReq.request.method).toBe('GET');
    resultReq.flush({ running: false, result: null });
    fixture.detectChanges();

    expect(fixture.componentInstance.agentStatus()).toBeNull();
    expect(http.match((req) => req.url === RESULT_URL)).toEqual([]);
  });

  it('resumes polling when the agent is still generating on open', () => {
    openSession();
    http.expectOne(HISTORY_URL).flush(USER_MESSAGES);
    fixture.detectChanges();

    http.expectOne(RESULT_URL).flush({ running: true, result: null });
    fixture.detectChanges();

    expect(fixture.componentInstance.agentStatus()).toBe('thinking');
  });

  it('does not check the result when the last message already has a reply', () => {
    openSession();
    http.expectOne(HISTORY_URL).flush(ANSWERED_MESSAGES);
    fixture.detectChanges();

    expect(fixture.componentInstance.agentStatus()).toBeNull();
    http.expectNone(RESULT_URL);
  });
});

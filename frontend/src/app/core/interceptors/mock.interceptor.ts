import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { Order, Message, Parameter, CalculationStatus } from '../models/models';

const mockSessions = new Map<string, Order>();
let sessionCounter = 0;

function createMockSession(): Order {
  const id = `session-${++sessionCounter}`;
  const session: Order = {
    id,
    status: CalculationStatus.Waiting,
    createdAt: new Date().toISOString()
  };
  mockSessions.set(id, session);
  return session;
}

export const mockInterceptor: HttpInterceptorFn = (req, next) => {
  const url = req.url;
  const method = req.method;

  if (url.endsWith('/sessions') && method === 'POST') {
    return of(new HttpResponse({ status: 200, body: createMockSession() }));
  }

  const sessionMatch = url.match(/\/sessions\/([^/]+)$/);
  if (sessionMatch && method === 'GET') {
    const id = sessionMatch[1];
    const session = mockSessions.get(id) || {
      id,
      status: CalculationStatus.Done,
      createdAt: new Date().toISOString()
    };
    return of(new HttpResponse({ status: 200, body: session }));
  }

  const messagesMatch = url.match(/\/sessions\/([^/]+)\/messages$/);
  if (messagesMatch && method === 'POST') {
    const message: Message = {
      id: `msg-${Date.now()}`,
      role: 'agent',
      content: 'Это мок-ответ агента. Уточните параметры детали.',
      timestamp: new Date().toISOString()
    };
    return of(new HttpResponse({ status: 200, body: message }));
  }

  const paramsMatch = url.match(/\/sessions\/([^/]+)\/params$/);
  if (paramsMatch && method === 'GET') {
    const params: Parameter[] = [
      { name: 'Материал', value: 'Сталь 3', source: 'текст' },
      { name: 'Толщина', value: '2 мм', source: 'текст' },
      { name: 'Количество', value: '10', source: 'текст' }
    ];
    return of(new HttpResponse({ status: 200, body: params }));
  }

  const downloadMatch = url.match(/\/sessions\/([^/]+)\/download$/);
  if (downloadMatch && method === 'GET') {
    return of(new HttpResponse({ status: 200, body: new Blob(['mock']) }));
  }

  return next(req);
};

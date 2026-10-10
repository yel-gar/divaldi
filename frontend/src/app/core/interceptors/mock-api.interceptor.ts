import {
  HttpErrorResponse,
  HttpEvent,
  HttpInterceptorFn,
  HttpResponse
} from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { delay, mergeMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AdminUser, InstanceSettings, User, UserRole } from '../models/models';

const MOCK_USERNAME = 'admin';
const MOCK_PASSWORD = 'admin123';

const CURRENT_USER: User = {
  id: 1,
  username: MOCK_USERNAME,
  first_name: 'Админ',
  last_name: 'Демо',
  role: 'superuser'
};

const SESSION_KEY = 'mock-authenticated';

const isLoggedIn = (): boolean => localStorage.getItem(SESSION_KEY) === '1';
const setLoggedIn = (value: boolean): void => localStorage.setItem(SESSION_KEY, value ? '1' : '0');
let nextUserId = 4;

const users: AdminUser[] = [
  {
    id: 1,
    username: 'admin',
    first_name: 'Админ',
    last_name: 'Демо',
    role: 'superuser',
    expires_at: null
  },
  {
    id: 2,
    username: 'ivanov',
    first_name: 'Иван',
    last_name: 'Иванов',
    role: 'user',
    expires_at: '2100-01-01T00:00:00Z'
  },
  {
    id: 3,
    username: 'petrov',
    first_name: 'Пётр',
    last_name: 'Петров',
    role: 'user',
    expires_at: '2000-01-01T00:00:00Z'
  }
];

const settings: InstanceSettings = {
  prompt_extension: '',
  parameters: {
    laser_speed_m_per_hour: 10,
    welding_speed_m_per_hour: 2,
    bending_rate_per_hour: 84,
    painting_rate_m2_per_hour: 5.53
  },
  last_update_by: null,
  last_update_at: null
};

type MockResponse = Observable<HttpEvent<unknown>>;

const fail = (status: number, message: string): MockResponse =>
  throwError(
    () =>
      new HttpErrorResponse({
        status,
        statusText: message,
        error: { detail: message }
      })
  );

const ok = <T>(body: T): MockResponse =>
  of(new HttpResponse({ status: 200, body })) as MockResponse;

export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.useMocks) {
    return next(req);
  }

  const respond = (): MockResponse => {
    const url = req.url.replace(environment.apiUrl, '');
    const [path, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    const body = req.body as Record<string, unknown> | null;

    if (path === '/auth/login' && req.method === 'POST') {
      if (body?.['username'] === MOCK_USERNAME && body?.['password'] === MOCK_PASSWORD) {
        setLoggedIn(true);
        return ok({ message: 'ok' });
      }
      return fail(401, 'Неверное имя пользователя или пароль');
    }

    if (path === '/auth/logout' && req.method === 'POST') {
      setLoggedIn(false);
      return ok({ message: 'ok' });
    }

    if (!isLoggedIn()) {
      return fail(401, 'Не авторизован');
    }

    if (path === '/users/me') {
      return ok(CURRENT_USER);
    }

    if (path === '/users/me/avatar') {
      return fail(404, 'No avatar');
    }

    if (path === '/chats') {
      return ok({ items: [], total: 0, page: Number(params.get('page') ?? 0) });
    }

    if (path === '/admin/users' && req.method === 'GET') {
      return ok(users.map((user) => ({ ...user })));
    }

    if (path === '/admin/users' && req.method === 'POST') {
      const created: AdminUser = {
        id: nextUserId++,
        username: String(body?.['username'] ?? ''),
        first_name: (body?.['first_name'] as string | null) ?? null,
        last_name: (body?.['last_name'] as string | null) ?? null,
        role: (body?.['role'] as UserRole | undefined) ?? 'user',
        expires_at: (body?.['expires_at'] as string | null) ?? null
      };
      users.push(created);
      return ok({ ...created });
    }

    const userMatch = path.match(/^\/admin\/users\/(\d+)(\/set-password)?$/);
    if (userMatch) {
      const user = users.find((candidate) => candidate.id === Number(userMatch[1]));
      if (!user) {
        return fail(404, 'Пользователь не найден');
      }
      if (userMatch[2]) {
        return ok({ message: 'ok' });
      }
      if (req.method === 'PATCH') {
        Object.assign(user, body);
        return ok({ ...user });
      }
      if (req.method === 'DELETE') {
        users.splice(users.indexOf(user), 1);
        return ok({ ...user });
      }
    }

    if (path === '/admin/settings') {
      if (req.method === 'PUT') {
        const patch = body as Partial<InstanceSettings> | null;
        if (patch?.['prompt_extension'] !== undefined) {
          settings.prompt_extension = patch['prompt_extension'];
        }
        if (patch?.['parameters'] !== undefined && patch['parameters'] !== null) {
          settings.parameters = patch['parameters'];
        }
        settings.last_update_by = CURRENT_USER.id;
        settings.last_update_at = new Date().toISOString();
      }
      return ok({ ...settings, parameters: { ...settings.parameters } });
    }

    return fail(404, `Мок не знает адрес ${req.method} ${path}`);
  };

  return of(null).pipe(mergeMap(respond), delay(150));
};

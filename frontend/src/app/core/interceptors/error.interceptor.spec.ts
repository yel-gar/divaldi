import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpContext,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Observable } from 'rxjs';

import { errorInterceptor } from './error.interceptor';
import { SKIP_AUTH_ERROR_HANDLING } from './skip-auth-error-handling';
import { NotificationService } from '../services/notification.service';
import { environment } from '../../../environments/environment';

const ME_URL = `${environment.apiUrl}/users/me`;
const LOGIN_URL = `${environment.apiUrl}/auth/login`;

describe('errorInterceptor', () => {
  let http: HttpTestingController;
  let httpClient: HttpClient;
  let notifications: NotificationService;

  const failed = (source: Observable<unknown>): Promise<HttpErrorResponse> =>
    new Promise((resolve) => source.subscribe({ error: resolve }));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', children: [] }]),
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpTestingController);
    httpClient = TestBed.inject(HttpClient);
    notifications = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    http.verify();
  });

  it('passes successful requests through untouched', async () => {
    const result = new Promise<unknown>((resolve) => {
      httpClient.get(ME_URL).subscribe(resolve);
    });

    const req = http.expectOne(ME_URL);
    expect(req.request.method).toBe('GET');
    req.flush({ id: 1 });

    expect(await result).toEqual({ id: 1 });
    expect(notifications.notifications()).toEqual([]);
  });

  it('shows the api detail message and rethrows the error', async () => {
    const error = failed(httpClient.get(ME_URL));

    http
      .expectOne(ME_URL)
      .flush({ detail: 'Пользователь не найден' }, { status: 404, statusText: 'Not Found' });

    expect((await error).status).toBe(404);
    expect(notifications.notifications()[0].type).toBe('error');
    expect(notifications.notifications()[0].message).toBe('Пользователь не найден');
  });

  it('shows a generic server message for 5xx responses', async () => {
    const error = failed(httpClient.get(ME_URL));

    http.expectOne(ME_URL).flush({ detail: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect((await error).status).toBe(500);
    expect(notifications.notifications()[0].message).toBe('Ошибка сервера');
  });

  it('shows the offline message when the request never reached the server', async () => {
    const error = failed(httpClient.get(ME_URL));

    http
      .expectOne(ME_URL)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    expect((await error).status).toBe(0);
    expect(notifications.notifications()[0].message).toBe('Не удалось связаться с сервером');
  });

  it('notifies about an unauthorized response and redirects to login', async () => {
    const error = failed(httpClient.get(ME_URL));

    http
      .expectOne(ME_URL)
      .flush({ detail: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect((await error).status).toBe(401);
    expect(notifications.notifications()[0].message).toBe('Вы не авторизованы');
  });

  it('does not notify twice for concurrent unauthorized responses', async () => {
    const first = failed(httpClient.get(ME_URL));
    const second = failed(httpClient.get(ME_URL));

    http
      .match(ME_URL)
      .forEach((req) =>
        req.flush({ detail: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' })
      );

    await Promise.all([first, second]);

    expect(notifications.notifications().length).toBe(1);
  });

  it('does not handle login failures because the login route is excluded', async () => {
    const error = failed(httpClient.post(LOGIN_URL, {}));

    http
      .expectOne(LOGIN_URL)
      .flush({ detail: 'Неверный логин' }, { status: 401, statusText: 'Unauthorized' });

    expect((await error).status).toBe(401);
    expect(notifications.notifications()).toEqual([]);
  });

  it('does not handle errors for requests carrying the skip context token', async () => {
    const context = new HttpContext().set(SKIP_AUTH_ERROR_HANDLING, true);
    const error = failed(httpClient.get(ME_URL, { context }));

    http.expectOne(ME_URL).flush({ detail: 'Ошибка' }, { status: 403, statusText: 'Forbidden' });

    expect((await error).status).toBe(403);
    expect(notifications.notifications()).toEqual([]);
  });

  it('shows the first validation message of a 422 response', async () => {
    const error = failed(httpClient.get(ME_URL));

    http
      .expectOne(ME_URL)
      .flush(
        { detail: [{ msg: 'Пароль слишком короткий' }] },
        { status: 422, statusText: 'Unprocessable Entity' }
      );

    expect((await error).status).toBe(422);
    expect(notifications.notifications()[0].message).toBe('Пароль слишком короткий');
  });

  it('falls back to the validation placeholder when a validation entry has no message', async () => {
    const error = failed(httpClient.get(ME_URL));

    http
      .expectOne(ME_URL)
      .flush(
        { detail: [{ loc: ['body', 'password'] }] },
        { status: 422, statusText: 'Unprocessable Entity' }
      );

    expect((await error).status).toBe(422);
    expect(notifications.notifications()[0].message).toBe(
      'Проверьте корректность введённых данных'
    );
  });
});

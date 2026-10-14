import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { environment as mockEnvironment } from '../../../environments/environment.mock';
import { mockApiInterceptor } from './mock-api.interceptor';
import type { AdminUser, InstanceSettings, UserChat } from '../../core/models/models';

const API = environment.apiUrl;

describe('mockApiInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  const login = (): Promise<unknown> =>
    firstValueFrom(http.post(`${API}/auth/login`, { username: 'admin', password: 'admin123' }));

  beforeEach(() => {
    environment.useMocks = true;
    localStorage.removeItem('mock-authenticated');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([mockApiInterceptor])),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    environment.useMocks = false;
    localStorage.removeItem('mock-authenticated');
    controller.verify();
  });

  it('keeps the mock environment file in sync', () => {
    expect(mockEnvironment.useMocks).toBe(true);
  });

  it('passes requests through when mocks are disabled', async () => {
    environment.useMocks = false;
    const request = firstValueFrom(http.get('/plain-endpoint'));
    const pending = controller.expectOne('/plain-endpoint');
    pending.flush({ ok: true });
    await expect(request).resolves.toEqual({ ok: true });
  });

  it('rejects wrong credentials with 401', async () => {
    const request = firstValueFrom(
      http.post(`${API}/auth/login`, { username: 'admin', password: 'nope' })
    );
    await expect(request).rejects.toMatchObject({ status: 401 });
  });

  it('accepts the demo credentials and marks the session', async () => {
    await login();
    expect(localStorage.getItem('mock-authenticated')).toBe('1');
  });

  it('returns 401 for protected routes before login', async () => {
    await expect(firstValueFrom(http.get(`${API}/users/me`))).rejects.toMatchObject({
      status: 401
    });
  });

  it('clears the session on logout', async () => {
    await login();
    await firstValueFrom(http.post(`${API}/auth/logout`, {}));
    expect(localStorage.getItem('mock-authenticated')).toBe('0');
  });

  it('serves the current user and no avatar', async () => {
    await login();
    await expect(firstValueFrom(http.get(`${API}/users/me`))).resolves.toMatchObject({
      username: 'admin',
      role: 'superuser'
    });
    await expect(firstValueFrom(http.get(`${API}/users/me/avatar`))).rejects.toMatchObject({
      status: 404
    });
  });

  it('serves paginated chats sorted by date', async () => {
    await login();
    const response = await firstValueFrom(
      http.get<{
        items: UserChat[];
        total: number;
        page: number;
        items_per_page: number;
      }>(`${API}/chats?page=0&items_per_page=3&sort=date&order=desc`)
    );
    expect(response.total).toBe(7);
    expect(response.page).toBe(0);
    expect(response.items_per_page).toBe(3);
    expect(response.items.length).toBe(3);
    const dates = response.items.map((chat) => new Date(chat.last_message.timestamp).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('sorts chats by number in ascending order', async () => {
    await login();
    const response = await firstValueFrom(
      http.get<{ items: UserChat[] }>(`${API}/chats?page=1&items_per_page=4&sort=number&order=asc`)
    );
    expect(response.items.length).toBe(3);
    expect(response.items[0].name).toBe('Кожух вентилятора');
  });

  it('serves chat messages for the trailing-slash list path', async () => {
    await login();
    const response = await firstValueFrom(http.get<{ items: UserChat[] }>(`${API}/chats/`));
    expect(response.items.length).toBe(7);
  });

  it('serves messages and a finished result for a session', async () => {
    await login();
    const list = await firstValueFrom(
      http.get<{ items: UserChat[] }>(`${API}/chats?page=0&items_per_page=1&sort=date&order=desc`)
    );
    const sessionId = list.items[0].session_id;
    const messages = await firstValueFrom(http.get(`${API}/chats/${sessionId}`));
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ role: 'assistant' })
      ])
    );
    const result = await firstValueFrom(
      http.get<{ running: boolean; result: { type: string } | null }>(
        `${API}/chats/${sessionId}/result`
      )
    );
    expect(result.running).toBe(false);
    expect(result.result?.type).toBe('success');
  });

  it('rejects an unknown session with 403', async () => {
    await login();
    await expect(firstValueFrom(http.get(`${API}/chats/does-not-exist`))).rejects.toMatchObject({
      status: 403
    });
  });

  it('serves the seeded users list', async () => {
    await login();
    const users = await firstValueFrom(http.get<AdminUser[]>(`${API}/admin/users`));
    expect(users.map((user) => user.username)).toEqual(['admin', 'ivanov', 'petrov']);
  });

  it('creates, edits and deletes a user', async () => {
    await login();
    const created = await firstValueFrom(
      http.post<AdminUser>(`${API}/admin/users`, {
        username: 'sidorov',
        first_name: 'Сидор',
        last_name: 'Сидоров',
        expires_at: null
      })
    );
    expect(created.id).toBeGreaterThan(3);
    expect(created.role).toBe('user');

    const edited = await firstValueFrom(
      http.patch<AdminUser>(`${API}/admin/users/${created.id}`, { first_name: 'Сидор Петр' })
    );
    expect(edited.first_name).toBe('Сидор Петр');

    await firstValueFrom(
      http.post(`${API}/admin/users/${created.id}/set-password`, { password: 'secret123' })
    );

    const removed = await firstValueFrom(
      http.delete<AdminUser>(`${API}/admin/users/${created.id}`)
    );
    expect(removed.username).toBe('sidorov');
    const remaining = await firstValueFrom(http.get<AdminUser[]>(`${API}/admin/users`));
    expect(remaining).toHaveLength(3);
  });

  it('rejects mutations of an unknown user with 404', async () => {
    await login();
    await expect(firstValueFrom(http.delete(`${API}/admin/users/999`))).rejects.toMatchObject({
      status: 404
    });
  });

  it('serves and updates instance settings', async () => {
    await login();
    const initial = await firstValueFrom(http.get<InstanceSettings>(`${API}/admin/settings`));
    expect(initial.parameters.laser_speed_m_per_hour).toBe(10);

    const updated = await firstValueFrom(
      http.put<InstanceSettings>(`${API}/admin/settings`, {
        prompt_extension: 'тест',
        parameters: { ...initial.parameters, welding_speed_m_per_hour: 3 }
      })
    );
    expect(updated.prompt_extension).toBe('тест');
    expect(updated.parameters.welding_speed_m_per_hour).toBe(3);
    expect(updated.last_update_by).toBe(1);
    expect(updated.last_update_at).not.toBeNull();

    const reread = await firstValueFrom(http.get<InstanceSettings>(`${API}/admin/settings`));
    expect(reread.prompt_extension).toBe('тест');
  });

  it('rejects unknown routes with 404', async () => {
    await login();
    await expect(firstValueFrom(http.get(`${API}/definitely-not-a-route`))).rejects.toMatchObject({
      status: 404
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AdminUsersService } from './admin-users.service';
import { environment } from '../../../environments/environment';

const BASE_URL = `${environment.apiUrl}/admin/users`;

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AdminUsersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('lists users', () => {
    let result: unknown;

    service.list().subscribe((users) => (result = users));

    const req = http.expectOne((r) => r.url === BASE_URL && r.method === 'GET');
    req.flush([]);

    expect(result).toEqual([]);
  });

  it('creates a user', () => {
    let result: unknown;

    service
      .create({
        username: 'sidorov',
        password: 'password123',
        first_name: 'Сидор',
        last_name: 'Сидоров',
        expires_at: null
      })
      .subscribe((user) => (result = user));

    const req = http.expectOne((r) => r.url === BASE_URL && r.method === 'POST');
    expect(req.request.body.username).toBe('sidorov');
    req.flush({ id: 1 }, { status: 201, statusText: 'Created' });

    expect(result).toEqual({ id: 1 });
  });

  it('edits a user via patch', () => {
    let result: unknown;

    service
      .edit(2, { username: 'ivanov', first_name: 'Иван', last_name: 'Иванов', expires_at: null })
      .subscribe((user) => (result = user));

    const req = http.expectOne((r) => r.url === `${BASE_URL}/2` && r.method === 'PATCH');
    req.flush({ id: 2 });

    expect(result).toEqual({ id: 2 });
  });

  it('sets a user password', () => {
    let result: unknown;

    service.setPassword(2, 'newpassword1').subscribe((response) => (result = response));

    const req = http.expectOne(
      (r) => r.url === `${BASE_URL}/2/set-password` && r.method === 'POST'
    );
    expect(req.request.body).toEqual({ password: 'newpassword1' });
    req.flush({ message: 'Password changed successfully' });

    expect(result).toEqual({ message: 'Password changed successfully' });
  });

  it('deletes a user', () => {
    let result: unknown;

    service.remove(2).subscribe((user) => (result = user));

    const req = http.expectOne((r) => r.url === `${BASE_URL}/2` && r.method === 'DELETE');
    req.flush({ id: 2 });

    expect(result).toEqual({ id: 2 });
  });
});

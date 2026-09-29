import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const LOGIN_URL = `${environment.apiUrl}/auth/login`;
const LOGOUT_URL = `${environment.apiUrl}/auth/logout`;

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('posts the credentials to the login endpoint', () => {
    let result: { message: string } | undefined;

    service.login('admin', 'password123').subscribe((response) => {
      result = response;
    });

    const req = http.expectOne(LOGIN_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'admin', password: 'password123' });
    req.flush({ message: 'Logged in' });

    expect(result?.message).toBe('Logged in');
  });

  it('posts an empty body to the logout endpoint', () => {
    let result: { message: string } | undefined;

    service.logout().subscribe((response) => {
      result = response;
    });

    const req = http.expectOne(LOGOUT_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ message: 'Logged out' });

    expect(result?.message).toBe('Logged out');
  });
});

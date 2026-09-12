import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  RouterStateSnapshot,
  UrlTree
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom, Observable } from 'rxjs';

import { adminGuard, authGuard } from './auth.guard';
import { ProfileService } from '../services/profile.service';
import { environment } from '../../../environments/environment';
import { User } from '../models/models';

const ME_URL = `${environment.apiUrl}/users/me`;

const testUser: User = {
  id: 1,
  username: 'admin',
  first_name: null,
  last_name: null,
  is_superuser: true
};

const route = {} as ActivatedRouteSnapshot;
const state = { url: '/create' } as RouterStateSnapshot;

function runGuard(guard: typeof authGuard | typeof adminGuard) {
  return TestBed.runInInjectionContext(() => guard(route, state));
}

describe('Auth guards', () => {
  let http: HttpTestingController;
  let profile: ProfileService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([])),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpTestingController);
    profile = TestBed.inject(ProfileService);
  });

  afterEach(() => {
    http.verify();
  });

  it('authGuard redirects to /login with return param when me() fails', async () => {
    const result = runGuard(authGuard);
    const tree$ = firstValueFrom(result as Observable<UrlTree>);

    const req = http.expectOne(ME_URL);
    req.flush({ detail: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    const tree = await tree$;
    expect(tree.toString()).toContain('/login');
    expect(tree.toString()).toContain('return=%2Fcreate');
    expect(profile.user()).toBeNull();
  });

  it('authGuard allows navigation when me() succeeds', async () => {
    const result = runGuard(authGuard);
    const allowed = firstValueFrom(result as Observable<boolean>);

    const req = http.expectOne(ME_URL);
    req.flush(testUser);

    expect(await allowed).toBe(true);
    expect(profile.user()?.username).toBe('admin');
  });

  it('adminGuard redirects to /login when the profile is not loaded', () => {
    const result = runGuard(adminGuard);
    expect(result.toString()).toBe('/login');
  });

  it('adminGuard blocks non-superusers', () => {
    profile.user.set({ ...testUser, is_superuser: false });

    const result = runGuard(adminGuard);
    expect(result.toString()).toBe('/create');
  });

  it('adminGuard allows superusers', () => {
    profile.user.set(testUser);

    expect(runGuard(adminGuard)).toBe(true);
  });
});

describe('ProfileService fetchMe dedupe', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([])),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('shares a single in-flight request between concurrent callers', () => {
    const profile = TestBed.inject(ProfileService);

    const first = firstValueFrom(profile.fetchMe());
    const second = firstValueFrom(profile.fetchMe());

    const requests = http.match((r) => r.url === ME_URL);
    expect(requests.length).toBe(1);

    requests[0].flush(testUser);

    return Promise.all([first, second]).then(([a, b]) => {
      expect(a.username).toBe('admin');
      expect(b.username).toBe('admin');
    });
  });
});

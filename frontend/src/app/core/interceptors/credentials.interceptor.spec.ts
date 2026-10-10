import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { credentialsInterceptor } from './credentials.interceptor';

describe('credentialsInterceptor', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([credentialsInterceptor])),
        provideHttpClientTesting()
      ]
    });
  });

  it('marks outgoing requests with credentials', async () => {
    const controller = TestBed.inject(HttpTestingController);
    const request = firstValueFrom(TestBed.inject(HttpClient).get('/api/ping'));

    const pending = controller.expectOne('/api/ping');
    expect(pending.request.withCredentials).toBe(true);
    pending.flush({});

    await expect(request).resolves.toEqual({});
  });
});

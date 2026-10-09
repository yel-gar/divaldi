import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AdminSettingsService } from './admin-settings.service';
import { environment } from '../../../environments/environment';

const BASE_URL = `${environment.apiUrl}/admin/system-prompt`;

describe('AdminSettingsService', () => {
  let service: AdminSettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AdminSettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('gets the system prompt', () => {
    let result: unknown;

    service.getSystemPrompt().subscribe((schema) => (result = schema));

    const req = http.expectOne((r) => r.url === BASE_URL && r.method === 'GET');
    req.flush({ prompt: 'Ты — ассистент.' });

    expect(result).toEqual({ prompt: 'Ты — ассистент.' });
  });

  it('updates the system prompt', () => {
    let result: unknown;

    service.updateSystemPrompt('Новый промпт').subscribe((schema) => (result = schema));

    const req = http.expectOne((r) => r.url === BASE_URL && r.method === 'PUT');
    expect(req.request.body).toEqual({ prompt: 'Новый промпт' });
    req.flush({ prompt: 'Новый промпт' });

    expect(result).toEqual({ prompt: 'Новый промпт' });
  });
});

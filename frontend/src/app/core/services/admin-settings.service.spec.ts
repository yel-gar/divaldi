import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AdminSettingsService } from './admin-settings.service';
import { environment } from '../../../environments/environment';

const BASE_URL = `${environment.apiUrl}/admin/system-prompt`;
const PARAMS_URL = `${environment.apiUrl}/admin/parameters`;

const MACHINE_PARAMS = {
  laser_speed_m_per_hour: 10,
  welding_speed_m_per_hour: 2,
  bending_rate_per_hour: 84,
  painting_rate_m2_per_hour: 5.53,
  max_positions: 10
};

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

  it('gets the machine parameters', () => {
    let result: unknown;

    service.getMachineParameters().subscribe((params) => (result = params));

    const req = http.expectOne((r) => r.url === PARAMS_URL && r.method === 'GET');
    req.flush(MACHINE_PARAMS);

    expect(result).toEqual(MACHINE_PARAMS);
  });

  it('updates the machine parameters', () => {
    let result: unknown;
    const payload = {
      laser_speed_m_per_hour: 12.5,
      welding_speed_m_per_hour: 2,
      bending_rate_per_hour: 84,
      painting_rate_m2_per_hour: 5.53
    };

    service.updateMachineParameters(payload).subscribe((params) => (result = params));

    const req = http.expectOne((r) => r.url === PARAMS_URL && r.method === 'PUT');
    expect(req.request.body).toEqual(payload);
    req.flush({ ...payload, max_positions: 10 });

    expect(result).toEqual({ ...payload, max_positions: 10 });
  });
});

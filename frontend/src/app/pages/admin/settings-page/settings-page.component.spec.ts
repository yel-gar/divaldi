import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AdminSettingsPage } from './settings-page.component';
import { environment } from '../../../../environments/environment';

const SETTINGS_URL = `${environment.apiUrl}/admin/settings`;

const SETTINGS = {
  prompt_extension: 'Ты — ассистент по расчёту КП.',
  parameters: {
    laser_speed_m_per_hour: 10,
    welding_speed_m_per_hour: 2,
    bending_rate_per_hour: 84,
    painting_rate_m2_per_hour: 5.53
  },
  last_update_by: null,
  last_update_at: null
};

describe('AdminSettingsPage', () => {
  let fixture: ComponentFixture<AdminSettingsPage>;
  let component: AdminSettingsPage;
  let http: HttpTestingController;

  const flushSettings = (prompt_extension = SETTINGS.prompt_extension): void => {
    http
      .expectOne((req) => req.url === SETTINGS_URL && req.method === 'GET')
      .flush({ ...SETTINGS, prompt_extension });
  };

  const createPage = (prompt_extension = SETTINGS.prompt_extension): void => {
    fixture = TestBed.createComponent(AdminSettingsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushSettings(prompt_extension);
    fixture.detectChanges();
  };

  const paramsInput = (id: string): HTMLInputElement =>
    fixture.debugElement.query(By.css(`#${id}`)).nativeElement;

  const typeParam = (id: string, value: string): void => {
    const input = paramsInput(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const textarea = (): HTMLTextAreaElement =>
    fixture.debugElement.query(By.css('textarea')).nativeElement;

  const typePrompt = (value: string): void => {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminSettingsPage],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('loads the settings with a single request and enables both forms', () => {
    createPage();

    expect(component.promptForm.getRawValue().prompt).toBe('Ты — ассистент по расчёту КП.');
    expect(component.promptForm.controls.prompt.enabled).toBe(true);
    expect(textarea().value).toBe('Ты — ассистент по расчёту КП.');
    expect(component.paramsForm.getRawValue()).toEqual({
      laser_speed_m_per_hour: '10',
      welding_speed_m_per_hour: '2',
      bending_rate_per_hour: '84',
      painting_rate_m2_per_hour: '5.53'
    });
    expect(paramsInput('machine-laser').value).toBe('10');
  });

  it('keeps save disabled while untouched, blank or whitespace-only', () => {
    createPage();
    expect(component.canSave()).toBe(false);

    typePrompt('Новый промпт');
    expect(component.canSave()).toBe(true);

    typePrompt('');
    expect(component.canSave()).toBe(false);

    typePrompt('   ');
    expect(component.canSave()).toBe(false);
  });

  it('rejects a prompt extension over the server limit', () => {
    createPage();

    component.promptForm.controls.prompt.setValue('x'.repeat(8001));
    fixture.detectChanges();

    expect(component.canSave()).toBe(false);
  });

  it('saves an edited prompt as a partial settings update', () => {
    createPage();
    typePrompt('Новый промпт');

    component.save();

    const req = http.expectOne(SETTINGS_URL);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ prompt_extension: 'Новый промпт' });
    req.flush({ ...SETTINGS, prompt_extension: 'Новый промпт' });
    fixture.detectChanges();

    expect(component.promptForm.controls.prompt.pristine).toBe(true);
    expect(component.canSave()).toBe(false);
  });

  it('loads the machine parameters', () => {
    createPage();

    expect(component.paramsForm.getRawValue()).toEqual({
      laser_speed_m_per_hour: '10',
      welding_speed_m_per_hour: '2',
      bending_rate_per_hour: '84',
      painting_rate_m2_per_hour: '5.53'
    });
    expect(paramsInput('machine-laser').value).toBe('10');
    expect(component.canSaveParams()).toBe(false);
  });

  it('keeps parameter save disabled until the values change and stay positive', () => {
    createPage();
    expect(component.canSaveParams()).toBe(false);

    typeParam('machine-laser', '0');
    expect(component.canSaveParams()).toBe(false);

    typeParam('machine-laser', '12.5');
    expect(component.canSaveParams()).toBe(true);
  });

  it('saves edited parameters wrapped in a parameters key', () => {
    createPage();
    typeParam('machine-bending', '90');

    component.saveParams();

    const req = http.expectOne(SETTINGS_URL);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      parameters: {
        laser_speed_m_per_hour: 10,
        welding_speed_m_per_hour: 2,
        bending_rate_per_hour: 90,
        painting_rate_m2_per_hour: 5.53
      }
    });
    req.flush({
      ...SETTINGS,
      parameters: {
        laser_speed_m_per_hour: 10,
        welding_speed_m_per_hour: 2,
        bending_rate_per_hour: 90,
        painting_rate_m2_per_hour: 5.53
      }
    });
    fixture.detectChanges();

    expect(component.paramsForm.pristine).toBe(true);
    expect(component.canSaveParams()).toBe(false);
  });
});

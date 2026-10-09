import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AdminSettingsPage } from './settings-page.component';
import { environment } from '../../../../environments/environment';

describe('AdminSettingsPage', () => {
  let fixture: ComponentFixture<AdminSettingsPage>;
  let component: AdminSettingsPage;
  let http: HttpTestingController;

  const flushPrompt = (prompt: string): void => {
    http.expectOne(`${environment.apiUrl}/admin/system-prompt`).flush({ prompt });
  };

  const flushParams = (): void => {
    http.expectOne(`${environment.apiUrl}/admin/parameters`).flush({
      laser_speed_m_per_hour: 10,
      welding_speed_m_per_hour: 2,
      bending_rate_per_hour: 84,
      painting_rate_m2_per_hour: 5.53,
      max_positions: 10
    });
  };

  const createPage = (prompt = 'Ты — ассистент по расчёту КП.'): void => {
    fixture = TestBed.createComponent(AdminSettingsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushPrompt(prompt);
    flushParams();
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

  it('loads the system prompt and enables the form', () => {
    createPage();

    expect(component.promptForm.getRawValue().prompt).toBe('Ты — ассистент по расчёту КП.');
    expect(component.promptForm.controls.prompt.enabled).toBe(true);
    expect(textarea().value).toBe('Ты — ассистент по расчёту КП.');
  });

  it('keeps save disabled while untouched and validates the prompt', () => {
    createPage();
    expect(component.canSave()).toBe(false);

    typePrompt('');
    expect(component.canSave()).toBe(false);

    typePrompt('Новый промпт');
    expect(component.canSave()).toBe(true);
  });

  it('saves an edited prompt and resets the dirty state', () => {
    createPage();
    typePrompt('Новый промпт');

    component.save();

    const req = http.expectOne(`${environment.apiUrl}/admin/system-prompt`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ prompt: 'Новый промпт' });
    req.flush({ prompt: 'Новый промпт' });
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

  it('saves edited parameters without max positions and resets the dirty state', () => {
    createPage();
    typeParam('machine-bending', '90');

    component.saveParams();

    const req = http.expectOne(`${environment.apiUrl}/admin/parameters`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      laser_speed_m_per_hour: 10,
      welding_speed_m_per_hour: 2,
      bending_rate_per_hour: 90,
      painting_rate_m2_per_hour: 5.53
    });
    req.flush({
      laser_speed_m_per_hour: 10,
      welding_speed_m_per_hour: 2,
      bending_rate_per_hour: 90,
      painting_rate_m2_per_hour: 5.53,
      max_positions: 10
    });
    fixture.detectChanges();

    expect(component.paramsForm.pristine).toBe(true);
    expect(component.canSaveParams()).toBe(false);
  });
});

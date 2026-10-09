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

  const createPage = (prompt = 'Ты — ассистент по расчёту КП.'): void => {
    fixture = TestBed.createComponent(AdminSettingsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushPrompt(prompt);
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

  it('reverts edits back to the last saved prompt', () => {
    createPage();
    typePrompt('Черновик');
    expect(component.canCancel()).toBe(true);

    component.revert();
    fixture.detectChanges();

    expect(component.promptForm.getRawValue().prompt).toBe('Ты — ассистент по расчёту КП.');
    expect(component.promptForm.controls.prompt.pristine).toBe(true);
    expect(component.canCancel()).toBe(false);
  });
});

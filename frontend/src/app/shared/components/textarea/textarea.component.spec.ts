import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';

import { Textarea } from './textarea.component';

@Component({
  selector: 'app-test-host',
  imports: [Textarea, ReactiveFormsModule],
  template: `
    <label for="description">Описание</label>
    <app-textarea [formControl]="control" inputId="description" [maxLength]="10" />
  `
})
class TestHost {
  readonly control = new FormControl('', { nonNullable: true });
}

describe('Textarea', () => {
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;
  let textarea: HTMLTextAreaElement;

  const getCounter = () => fixture.debugElement.query(By.css('.textarea__counter'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    textarea = fixture.debugElement.query(By.css('textarea')).nativeElement;
  });

  it('should propagate user input to the form control and update the counter', async () => {
    textarea.value = 'Привет';
    textarea.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(host.control.value).toBe('Привет');
    expect(getCounter().nativeElement.textContent).toContain('6/10');
  });

  it('should write the control value into the textarea', async () => {
    host.control.setValue('из формы');
    await fixture.whenStable();

    expect(textarea.value).toBe('из формы');
  });

  it('should highlight the counter when the max length is reached', async () => {
    host.control.setValue('0123456789');
    await fixture.whenStable();

    expect(getCounter().nativeElement.classList).toContain('textarea__counter--max');
  });

  it('should mark the control touched on blur', async () => {
    expect(host.control.touched).toBe(false);

    textarea.dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    expect(host.control.touched).toBe(true);
  });

  it('should link the external label to the textarea through inputId', () => {
    expect(textarea.id).toBe('description');
  });

  it('should disable the textarea when the form control is disabled', async () => {
    host.control.disable();
    await fixture.whenStable();

    expect(textarea.disabled).toBe(true);
  });
});

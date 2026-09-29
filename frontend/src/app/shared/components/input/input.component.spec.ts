import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { LucideEye, LucideUser } from '@lucide/angular';
import { vi } from 'vitest';

import { InputComponent } from './input.component';

@Component({
  selector: 'app-test-host',
  imports: [InputComponent, ReactiveFormsModule],
  template: `
    <app-input
      [formControl]="control"
      inputId="login"
      placeholder="ivan"
      [leftIcon]="userIcon"
      [rightIcon]="eyeIcon"
      [leftIconInteractive]="true"
      [rightIconInteractive]="true"
      rightIconLabel="Показать пароль"
      (leftIconClick)="leftClicks.set(leftClicks() + 1)"
      (rightIconClick)="rightClicks.set(rightClicks() + 1)"
    />
  `
})
class TestHost {
  readonly control = new FormControl('', { nonNullable: true });
  readonly userIcon = LucideUser;
  readonly eyeIcon = LucideEye;
  readonly leftClicks = signal(0);
  readonly rightClicks = signal(0);
}

@Component({
  selector: 'app-textarea-test-host',
  imports: [InputComponent],
  template: `<app-input inputId="notes" asTextarea="true" [autoResize]="true" [rows]="3" />`
})
class TextareaTestHost {}

@Component({
  selector: 'app-external-test-host',
  imports: [InputComponent],
  template: `<app-input [value]="external()" />`
})
class ExternalTestHost {
  readonly external = signal('извне');
}

@Component({
  selector: 'app-disabled-test-host',
  imports: [InputComponent],
  template: `<app-input inputId="frozen" [disabled]="isDisabled()" />`
})
class DisabledTestHost {
  readonly isDisabled = signal(false);
}

@Component({
  selector: 'app-error-test-host',
  imports: [InputComponent, ReactiveFormsModule],
  template: `<app-input [formControl]="control" inputId="required" />`
})
class ErrorTestHost {
  readonly control = new FormControl('', { nonNullable: true, validators: Validators.required });
}

describe('InputComponent', () => {
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;
  let input: InputComponent;

  const getInput = () =>
    fixture.debugElement.query(By.css('input')).nativeElement as HTMLInputElement;
  const iconButton = (side: 'left' | 'right') =>
    fixture.debugElement.query(By.css(`.input__icon--${side}.input__icon--interactive`));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    input = fixture.debugElement.query(By.directive(InputComponent))
      .componentInstance as InputComponent;
  });

  it('renders the bound attributes onto the native input', () => {
    const native = getInput();
    expect(native.id).toBe('login');
    expect(native.placeholder).toBe('ivan');
    expect(native.type).toBe('text');
    expect(native.disabled).toBe(false);
  });

  it('propagates user input to the form control and back', async () => {
    const native = getInput();
    native.value = 'ivan';
    native.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(host.control.value).toBe('ivan');
    expect(input.displayValue).toBe('ivan');

    host.control.setValue('petrov');
    await fixture.whenStable();

    expect(getInput().value).toBe('petrov');
  });

  it('emits valueChange and inputEvent alongside the control update', () => {
    const valueChanges: string[] = [];
    let inputEvents = 0;
    input.valueChange.subscribe((value) => valueChanges.push(value));
    input.inputEvent.subscribe(() => inputEvents++);

    const native = getInput();
    native.value = 'abc';
    native.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(valueChanges).toEqual(['abc']);
    expect(inputEvents).toBe(1);
  });

  it('marks the control touched on blur', () => {
    expect(host.control.touched).toBe(false);

    getInput().dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(host.control.touched).toBe(true);
  });

  it('follows the disabled state of the form control', async () => {
    host.control.disable();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(input.isDisabled()).toBe(true);
    expect(getInput().disabled).toBe(true);
  });

  it('emits leftIconClick and rightIconClick from the icon buttons', () => {
    iconButton('left').nativeElement.click();
    iconButton('right').nativeElement.click();

    expect(host.leftClicks()).toBe(1);
    expect(host.rightClicks()).toBe(1);

    const rightButton = iconButton('right').nativeElement as HTMLButtonElement;
    expect(rightButton.getAttribute('aria-label')).toBe('Показать пароль');
  });

  it('adopts an externally bound value', async () => {
    const externalFixture = TestBed.createComponent(ExternalTestHost);
    externalFixture.detectChanges();
    await externalFixture.whenStable();

    const externalInput = externalFixture.debugElement.query(By.directive(InputComponent))
      .componentInstance as InputComponent;
    expect(externalInput.displayValue).toBe('извне');

    externalFixture.componentInstance.external.set('новое');
    await externalFixture.whenStable();

    expect(externalInput.displayValue).toBe('новое');
  });

  it('renders a textarea and resizes it on every keystroke', async () => {
    const textareaFixture = TestBed.createComponent(TextareaTestHost);
    textareaFixture.detectChanges();
    await textareaFixture.whenStable();

    const textarea = textareaFixture.debugElement.query(By.css('textarea'))
      .nativeElement as HTMLTextAreaElement;
    expect(textarea.rows).toBe(3);
    expect(textarea.id).toBe('notes');

    const resize = vi.spyOn(textarea, 'scrollHeight', 'get').mockReturnValue(120);
    textarea.value = 'много текста';
    textarea.dispatchEvent(new Event('input'));
    textareaFixture.detectChanges();

    expect(textarea.style.height).toBe('120px');
    resize.mockRestore();
  });

  it('honours the disabled input independently of a form control', async () => {
    const disabledFixture = TestBed.createComponent(DisabledTestHost);
    disabledFixture.detectChanges();
    await disabledFixture.whenStable();

    const native = disabledFixture.debugElement.query(By.css('input'))
      .nativeElement as HTMLInputElement;
    expect(native.disabled).toBe(false);

    disabledFixture.componentInstance.isDisabled.set(true);
    await disabledFixture.whenStable();
    disabledFixture.detectChanges();

    expect(native.disabled).toBe(true);
  });

  it('shows the error state for a touched and invalid control', async () => {
    const errorFixture = TestBed.createComponent(ErrorTestHost);
    errorFixture.detectChanges();
    await errorFixture.whenStable();

    const host = errorFixture.debugElement.query(By.directive(InputComponent));
    expect(host.nativeElement.classList).not.toContain('input--error');

    errorFixture.componentInstance.control.markAsTouched();
    await errorFixture.whenStable();
    errorFixture.detectChanges();

    expect(host.nativeElement.classList).toContain('input--error');
    expect(
      (host.query(By.css('input')).nativeElement as HTMLInputElement).getAttribute('aria-invalid')
    ).toBe('true');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';

import { CheckboxComponent } from './checkbox.component';

@Component({
  selector: 'app-checkbox-test-host',
  imports: [CheckboxComponent, ReactiveFormsModule],
  template: `<app-checkbox [formControl]="control" [label]="label" [caption]="caption" />`
})
class TestHost {
  readonly label = 'Суперпользователь';
  readonly caption = 'Доступ ко всем чатам';
  readonly control = new FormControl<boolean | null>(null, { nonNullable: false });
}

@Component({
  selector: 'app-checkbox-required-test-host',
  imports: [CheckboxComponent, ReactiveFormsModule],
  template: `<app-checkbox [formControl]="control" label="Согласен" />`
})
class RequiredTestHost {
  readonly control = new FormControl<boolean | null>(null, Validators.requiredTrue);
}

describe('CheckboxComponent', () => {
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;
  let checkbox: CheckboxComponent;

  const getInput = (fx: ComponentFixture<unknown>) =>
    fx.debugElement.query(By.css('input.checkbox__input')).nativeElement as HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    checkbox = fixture.debugElement.query(By.directive(CheckboxComponent))
      .componentInstance as CheckboxComponent;
  });

  it('renders the label and the caption', () => {
    const text = fixture.debugElement.nativeElement.textContent as string;

    expect(text).toContain('Суперпользователь');
    expect(text).toContain('Доступ ко всем чатам');
  });

  it('propagates a user toggle to the form control', () => {
    const input = getInput(fixture);
    input.checked = true;
    input.dispatchEvent(new Event('change'));

    expect(host.control.value).toBe(true);
  });

  it('writes the form control value into the input', () => {
    host.control.setValue(true);
    fixture.detectChanges();

    expect(getInput(fixture).checked).toBe(true);
  });

  it('checks the input for a null control value', () => {
    host.control.setValue(null);
    fixture.detectChanges();

    expect(getInput(fixture).checked).toBe(false);
  });

  it('marks the control as touched on blur', () => {
    const input = getInput(fixture);
    input.dispatchEvent(new Event('blur'));

    expect(host.control.touched).toBe(true);
  });

  it('disables the input through the form control', async () => {
    host.control.disable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(checkbox.isDisabled()).toBe(true);
    expect(getInput(fixture).disabled).toBe(true);
    expect(
      (fixture.debugElement.nativeElement as HTMLElement).querySelector('.checkbox--disabled')
    ).not.toBeNull();
  });

  it('enables the input again when the control is re-enabled', async () => {
    host.control.disable();
    fixture.detectChanges();
    host.control.enable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(checkbox.isDisabled()).toBe(false);
    expect(getInput(fixture).disabled).toBe(false);
  });

  it('supports direct ControlValueAccessor calls', () => {
    const onChange = vi.fn();
    const onTouched = vi.fn();
    checkbox.registerOnChange(onChange);
    checkbox.registerOnTouched(onTouched);

    const input = getInput(fixture);
    input.checked = true;
    checkbox.onInput({ target: input } as unknown as Event);
    checkbox.onBlur();

    expect(onChange).toHaveBeenCalledWith(true);
    expect(onTouched).toHaveBeenCalledTimes(1);

    checkbox.writeValue(null);
    expect(checkbox.input.nativeElement.checked).toBe(false);

    checkbox.writeValue(true);
    expect(checkbox.input.nativeElement.checked).toBe(true);

    checkbox.setDisabledState(true);
    expect(checkbox.isDisabled()).toBe(true);
    expect(checkbox.input.nativeElement.disabled).toBe(true);
  });

  it('marks itself invalid once a required control is touched and empty', async () => {
    const requiredFixture = TestBed.createComponent(RequiredTestHost);
    requiredFixture.detectChanges();
    await requiredFixture.whenStable();
    const requiredCheckbox = requiredFixture.debugElement.query(By.directive(CheckboxComponent))
      .componentInstance as CheckboxComponent;

    expect(requiredCheckbox.showError()).toBe(false);

    const input = getInput(requiredFixture);
    input.dispatchEvent(new Event('blur'));
    requiredFixture.detectChanges();
    await requiredFixture.whenStable();

    expect(requiredCheckbox.showError()).toBe(true);
    expect(
      (requiredFixture.debugElement.nativeElement as HTMLElement).querySelector('.checkbox--error')
    ).not.toBeNull();
  });

  it('does not show an error without a form control', () => {
    const standalone = TestBed.createComponent(CheckboxComponent);
    standalone.detectChanges();

    expect(standalone.componentInstance.showError()).toBe(false);
  });
});

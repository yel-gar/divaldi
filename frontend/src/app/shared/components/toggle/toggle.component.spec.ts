import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';

import { ToggleComponent } from './toggle.component';

@Component({
  selector: 'app-toggle-test-host',
  imports: [ToggleComponent, ReactiveFormsModule],
  template: `<app-toggle [formControl]="control" [label]="label" [caption]="caption" />`
})
class TestHost {
  readonly label = 'Показывать превью';
  readonly caption = 'Открывать файл после загрузки';
  readonly control = new FormControl<boolean | null>(null, { nonNullable: false });
}

describe('ToggleComponent', () => {
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;
  let toggle: ToggleComponent;

  const getInput = (fx: ComponentFixture<unknown>) =>
    fx.debugElement.query(By.css('input.toggle__input')).nativeElement as HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    toggle = fixture.debugElement.query(By.directive(ToggleComponent))
      .componentInstance as ToggleComponent;
  });

  it('renders the label and the caption with aria-label on the input', () => {
    const text = fixture.debugElement.nativeElement.textContent as string;

    expect(text).toContain('Показывать превью');
    expect(text).toContain('Открывать файл после загрузки');
    expect(getInput(fixture).getAttribute('aria-label')).toBe('Показывать превью');
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

  it('disables the input through the form control', async () => {
    host.control.disable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(toggle.checkbox.nativeElement.disabled).toBe(true);
  });

  it('enables the input again when the control is re-enabled', async () => {
    host.control.disable();
    fixture.detectChanges();
    await fixture.whenStable();

    host.control.enable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(toggle.checkbox.nativeElement.disabled).toBe(false);
  });

  it('marks the control as touched on blur', () => {
    getInput(fixture).dispatchEvent(new Event('blur'));

    expect(host.control.touched).toBe(true);
  });

  it('supports direct ControlValueAccessor calls', () => {
    const onChange = vi.fn();
    const onTouched = vi.fn();
    toggle.registerOnChange(onChange);
    toggle.registerOnTouched(onTouched);

    const input = getInput(fixture);
    input.checked = true;
    toggle.onInput({ target: input } as unknown as Event);
    toggle.onBlur();

    expect(onChange).toHaveBeenCalledWith(true);
    expect(onTouched).toHaveBeenCalledTimes(1);

    toggle.writeValue(null as unknown as boolean);
    expect(toggle.checkbox.nativeElement.checked).toBe(false);

    toggle.writeValue(true);
    expect(toggle.checkbox.nativeElement.checked).toBe(true);

    toggle.setDisabledState(true);
    expect(toggle.checkbox.nativeElement.disabled).toBe(true);
  });

  it('falls back to no-op callbacks when used without a form control', () => {
    const standalone = TestBed.createComponent(ToggleComponent);
    standalone.detectChanges();
    const bare = standalone.componentInstance;
    const input = getInput(standalone);
    input.checked = true;

    expect(() => bare.onInput({ target: input } as unknown as Event)).not.toThrow();
    expect(() => bare.onBlur()).not.toThrow();
  });
});

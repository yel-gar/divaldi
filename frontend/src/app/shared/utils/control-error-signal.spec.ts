import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, NgControl, Validators } from '@angular/forms';
import { controlErrorSignal } from './control-error-signal';

describe('controlErrorSignal', () => {
  let injector: Injector;

  beforeEach(() => {
    injector = TestBed.inject(Injector);
  });

  it('leaves the target signal untouched when ngControl is null', () => {
    const showError = signal(false);
    controlErrorSignal(null, injector, showError);
    expect(showError()).toBe(false);
  });

  it('leaves the target signal untouched when control is null', () => {
    const showError = signal(false);
    controlErrorSignal({ control: null } as unknown as NgControl, injector, showError);
    expect(showError()).toBe(false);
  });

  it('sets showError to false for a valid, untouched control', () => {
    const control = new FormControl<string | null>('value');
    const showError = signal(false);
    controlErrorSignal(makeNgControl(control), injector, showError);

    expect(showError()).toBe(false);
  });

  it('sets showError to true when the control becomes invalid and touched', async () => {
    const control = new FormControl<string | null>(null, Validators.required);
    const showError = signal(false);
    controlErrorSignal(makeNgControl(control), injector, showError);

    control.markAsTouched();
    control.updateValueAndValidity();
    await new Promise((resolve) => setTimeout(resolve));

    expect(showError()).toBe(true);
  });

  it('sets showError to false again when the control becomes valid', async () => {
    const control = new FormControl<string | null>(null, Validators.required);
    const showError = signal(false);
    controlErrorSignal(makeNgControl(control), injector, showError);

    control.markAsTouched();
    control.updateValueAndValidity();
    await new Promise((resolve) => setTimeout(resolve));
    expect(showError()).toBe(true);

    control.setValue('value');
    await new Promise((resolve) => setTimeout(resolve));

    expect(showError()).toBe(false);
  });

  it('keeps showError false for an invalid but untouched control', () => {
    const control = new FormControl<string | null>(null, Validators.required);
    const showError = signal(false);
    controlErrorSignal(makeNgControl(control), injector, showError);

    expect(showError()).toBe(false);
  });

  function makeNgControl(control: FormControl): NgControl {
    return { control } as unknown as NgControl;
  }
});

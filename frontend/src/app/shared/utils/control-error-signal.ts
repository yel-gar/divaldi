import { Injector, WritableSignal, effect } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, NgControl } from '@angular/forms';

export function controlErrorSignal(
  ngControl: NgControl | null | undefined,
  injector: Injector,
  target: WritableSignal<boolean>
): void {
  const control: AbstractControl | null = ngControl?.control ?? null;
  if (!control) {
    return;
  }
  const controlEvents = toSignal(control.events, { initialValue: null, injector });
  effect(
    () => {
      controlEvents();
      target.set(control.invalid && control.touched);
    },
    { injector }
  );
}

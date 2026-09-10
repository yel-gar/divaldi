import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { noop } from 'rxjs';

@Component({
  selector: 'app-textarea',
  templateUrl: './textarea.html',
  styleUrl: './textarea.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Textarea implements ControlValueAccessor {
  readonly inputId = input<string>();
  readonly placeholder = input('');
  readonly maxLength = input<number>();

  readonly value = signal('');
  private readonly formDisabled = signal(false);

  readonly symbolsCount = computed(() => this.value().length);
  readonly isMaxLengthReached = computed(() => {
    const maxLength = this.maxLength();
    return maxLength !== undefined && this.symbolsCount() >= maxLength;
  });

  readonly isDisabled = computed(() => this.formDisabled());

  private readonly ngControl = inject(NgControl, { optional: true, self: true });

  private onChange: (value: string) => void = noop;
  private onTouched: () => void = noop;

  constructor() {
    if (this.ngControl) {
      this.ngControl.valueAccessor = this;
    }
  }

  onInput(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;

    this.value.set(value);
    this.onChange(value);
  }

  onBlur() {
    this.onTouched();
  }

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }
}

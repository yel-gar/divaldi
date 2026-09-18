import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  OnInit,
  signal
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { noop } from 'rxjs';
import { controlErrorSignal } from '../../utils/control-error-signal';

@Component({
  selector: 'app-textarea',
  host: {
    '[class.textarea--error]': 'showError()'
  },
  templateUrl: './textarea.component.html',
  styleUrl: './textarea.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Textarea implements ControlValueAccessor, OnInit {
  readonly inputId = input<string>();
  readonly placeholder = input('');
  readonly maxLength = input<number>();
  readonly counterVisibleFrom = input(0);

  readonly value = signal('');
  private readonly formDisabled = signal(false);

  readonly symbolsCount = computed(() => this.value().length);
  readonly isCounterVisible = computed(
    () => this.maxLength() !== undefined && this.symbolsCount() >= this.counterVisibleFrom()
  );
  readonly isMaxLengthReached = computed(() => {
    const maxLength = this.maxLength();
    return maxLength !== undefined && this.symbolsCount() >= maxLength;
  });

  readonly isDisabled = computed(() => this.formDisabled());
  readonly showError = signal(false);

  private readonly ngControl = inject(NgControl, { optional: true, self: true });
  private readonly injector = inject(Injector);

  private onChange: (value: string) => void = noop;
  private onTouched: () => void = noop;

  constructor() {
    if (this.ngControl) {
      this.ngControl.valueAccessor = this;
    }
  }

  ngOnInit(): void {
    controlErrorSignal(this.ngControl, this.injector, this.showError);
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

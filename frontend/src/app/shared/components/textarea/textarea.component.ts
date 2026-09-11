import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injector,
  input,
  OnInit,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { noop } from 'rxjs';

@Component({
  selector: 'app-textarea',
  host: {
    '[class.textarea--error]': 'showError()'
  },
  templateUrl: './textarea.html',
  styleUrl: './textarea.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Textarea implements ControlValueAccessor, OnInit {
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
    const control = this.ngControl?.control ?? null;
    if (!control) {
      return;
    }
    const controlEvents = toSignal(control.events, {
      initialValue: null,
      injector: this.injector
    });
    effect(
      () => {
        controlEvents();
        this.showError.set(control.invalid && control.touched);
      },
      { injector: this.injector }
    );
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

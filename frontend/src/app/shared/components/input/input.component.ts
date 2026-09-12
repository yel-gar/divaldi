import {
  ChangeDetectionStrategy,
  Component,
  computed,
  afterRenderEffect,
  effect,
  inject,
  Injector,
  input,
  OnInit,
  output,
  signal,
  ViewChild,
  ElementRef
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { LucideDynamicIcon, LucideIcon } from '@lucide/angular';
import { noop } from 'rxjs';

@Component({
  selector: 'app-input',
  standalone: true,
  imports: [LucideDynamicIcon],
  templateUrl: './input.component.html',
  styleUrl: './input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.input--error]': 'showError()',
    '[class.input--textarea]': 'asTextarea()'
  }
})
export class InputComponent implements ControlValueAccessor, OnInit {
  readonly inputId = input<string>();
  readonly placeholder = input('');
  readonly type = input<'text' | 'password' | 'email' | 'number' | 'tel' | 'url'>('text');
  readonly maxLength = input<number>();
  readonly leftIcon = input<LucideIcon>();
  readonly rightIcon = input<LucideIcon>();
  readonly leftIconInteractive = input(false, {
    transform: (v: boolean | string) => v === true || v === ''
  });
  readonly rightIconInteractive = input(false, {
    transform: (v: boolean | string) => v === true || v === ''
  });
  readonly disabled = input(false, {
    transform: (v: boolean | string) => v === true || v === 'true'
  });
  readonly asTextarea = input(false, {
    transform: (v: boolean | string) => v === true || v === 'true'
  });
  readonly autoResize = input(false, {
    transform: (v: boolean | string) => v === true || v === 'true'
  });
  readonly rows = input<number>(1);
  readonly value = input<string>('');
  readonly autocomplete = input('off');
  readonly ariaLabel = input('');

  readonly leftIconClick = output<MouseEvent>();
  readonly rightIconClick = output<MouseEvent>();
  readonly inputEvent = output<Event>();
  readonly valueChange = output<string>();

  private readonly _value = signal('');
  private readonly formDisabled = signal(false);

  readonly isDisabled = computed(() => this.formDisabled() || this.disabled());
  readonly showError = signal(false);

  @ViewChild('inputRef', { static: false }) inputRef?: ElementRef<
    HTMLInputElement | HTMLTextAreaElement
  >;

  private readonly ngControl = inject(NgControl, { optional: true, self: true });
  private readonly injector = inject(Injector);

  private onChange: (value: string) => void = noop;
  private onTouched: () => void = noop;
  private lastExternalValue = '';

  constructor() {
    if (this.ngControl) {
      this.ngControl.valueAccessor = this;
    }

    afterRenderEffect({
      write: () => {
        if (!this.asTextarea() || !this.autoResize()) {
          return;
        }
        this._value();
        this.resizeTextarea();
      }
    });
  }

  ngOnInit(): void {
    effect(
      () => {
        const externalValue = this.value();
        if (externalValue === this.lastExternalValue) {
          return;
        }
        this.lastExternalValue = externalValue;
        if (this._value() !== externalValue) {
          this._value.set(externalValue);
        }
      },
      { injector: this.injector }
    );

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

  get displayValue(): string {
    return this._value();
  }

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    this._value.set(target.value);
    this.onChange(target.value);
    this.valueChange.emit(target.value);
    this.inputEvent.emit(event);

    if (this.autoResize() && this.asTextarea()) {
      this.resizeTextarea();
    }
  }

  onBlur(): void {
    this.onTouched();
  }

  onLeftIconClick(event: MouseEvent): void {
    event.stopPropagation();
    this.leftIconClick.emit(event);
  }

  onRightIconClick(event: MouseEvent): void {
    event.stopPropagation();
    this.rightIconClick.emit(event);
  }

  resizeTextarea(): void {
    const textarea = this.inputRef?.nativeElement as HTMLTextAreaElement;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }

  writeValue(value: string | null): void {
    this._value.set(value ?? '');
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

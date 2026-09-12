import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
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
import { LucideCheck } from '@lucide/angular';
import { noop } from 'rxjs';

@Component({
  selector: 'app-checkbox',
  standalone: true,
  imports: [LucideCheck],
  templateUrl: './checkbox.component.html',
  styleUrl: './checkbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.checkbox--error]': 'showError()'
  }
})
export class CheckboxComponent implements ControlValueAccessor, OnInit {
  readonly label = input('');
  readonly caption = input('');

  readonly showError = signal(false);
  private readonly formDisabled = signal(false);

  readonly isDisabled = computed(() => this.formDisabled());

  @ViewChild('input', { static: true, read: ElementRef<HTMLInputElement> })
  input!: ElementRef<HTMLInputElement>;

  private readonly ngControl = inject(NgControl, { optional: true, self: true });
  private readonly injector = inject(Injector);

  private onChange: (checked: boolean) => void = noop;
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

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.onChange(target.checked);
  }

  onBlur(): void {
    this.onTouched();
  }

  writeValue(checked: boolean | null): void {
    this.input.nativeElement.checked = checked ?? false;
  }

  registerOnChange(fn: (checked: boolean) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
    this.input.nativeElement.disabled = isDisabled;
  }
}

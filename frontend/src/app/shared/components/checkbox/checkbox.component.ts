import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  Injector,
  input,
  OnInit,
  signal
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { LucideCheck } from '@lucide/angular';
import { noop } from 'rxjs';
import { controlErrorSignal } from '../../utils/control-error-signal';

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

  private readonly formDisabled = signal(false);

  readonly isDisabled = computed(() => this.formDisabled());

  @ViewChild('input', { static: true, read: ElementRef<HTMLInputElement> })
  input!: ElementRef<HTMLInputElement>;

  private readonly ngControl = inject(NgControl, { optional: true, self: true });
  private readonly injector = inject(Injector);

  readonly showError = signal(false);

  private onChange: (checked: boolean) => void = noop;
  private onTouched: () => void = noop;

  constructor() {
    if (this.ngControl) {
      this.ngControl.valueAccessor = this;
    }
  }

  ngOnInit(): void {
    controlErrorSignal(this.ngControl, this.injector, this.showError);
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

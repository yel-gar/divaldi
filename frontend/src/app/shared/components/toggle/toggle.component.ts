import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  forwardRef,
  input,
  ViewChild
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-toggle',
  standalone: true,
  templateUrl: './toggle.component.html',
  styleUrl: './toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ToggleComponent),
      multi: true
    }
  ]
})
export class ToggleComponent implements ControlValueAccessor {
  readonly label = input('');
  readonly caption = input('');

  @ViewChild('checkbox', { static: true, read: ElementRef<HTMLInputElement> })
  checkbox!: ElementRef<HTMLInputElement>;

  private onChange: (checked: boolean) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(checked: boolean): void {
    this.checkbox.nativeElement.checked = checked ?? false;
  }

  registerOnChange(fn: (checked: boolean) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.checkbox.nativeElement.disabled = isDisabled;
  }

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.onChange(target.checked);
  }

  onBlur(): void {
    this.onTouched();
  }
}

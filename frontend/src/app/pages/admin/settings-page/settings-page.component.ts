import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { Textarea } from '../../../shared/components/textarea/textarea.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { MachineParameters } from '../../../core/models/models';
import { AdminSettingsService } from '../../../core/services/admin-settings.service';
import { NotificationService } from '../../../core/services/notification.service';
import { extractApiErrorMessage } from '../../../shared/utils/api-error';

const MAX_PROMPT_EXTENSION_LENGTH = 8000;
const COUNTER_VISIBLE_FROM = 7000;
const POSITIVE_NUMBER_PATTERN = /^\d+(\.\d+)?$/;
const MIN_MACHINE_RATE = 0.01;

const MACHINE_RATE_VALIDATORS = [
  Validators.required,
  Validators.pattern(POSITIVE_NUMBER_PATTERN),
  Validators.min(MIN_MACHINE_RATE)
];

@Component({
  selector: 'app-admin-settings-page',
  imports: [ReactiveFormsModule, InputComponent, Textarea],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminSettingsPage {
  private readonly settingsService = inject(AdminSettingsService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly paramsLoading = signal(true);
  readonly savingParams = signal(false);

  readonly MAX_PROMPT_EXTENSION_LENGTH = MAX_PROMPT_EXTENSION_LENGTH;
  readonly COUNTER_VISIBLE_FROM = COUNTER_VISIBLE_FROM;

  readonly promptForm = this.fb.group({
    prompt: this.fb.control({ value: '', disabled: true }, [
      Validators.maxLength(MAX_PROMPT_EXTENSION_LENGTH)
    ])
  });

  private readonly promptValue = toSignal(this.promptForm.controls.prompt.valueChanges, {
    initialValue: ''
  });

  readonly canSave = computed(() => {
    const value = this.promptValue();
    const control = this.promptForm.controls.prompt;
    return (
      control.enabled && control.dirty && control.valid && value.trim().length > 0 && !this.saving()
    );
  });

  readonly paramsForm = this.fb.group({
    laser_speed_m_per_hour: this.fb.control('', MACHINE_RATE_VALIDATORS),
    welding_speed_m_per_hour: this.fb.control('', MACHINE_RATE_VALIDATORS),
    bending_rate_per_hour: this.fb.control('', MACHINE_RATE_VALIDATORS),
    painting_rate_m2_per_hour: this.fb.control('', MACHINE_RATE_VALIDATORS)
  });

  private readonly paramsState = toSignal(this.paramsForm.valueChanges, {
    initialValue: this.paramsForm.value
  });

  readonly canSaveParams = computed(() => {
    this.paramsState();
    return (
      this.paramsForm.enabled &&
      this.paramsForm.dirty &&
      this.paramsForm.valid &&
      !this.savingParams()
    );
  });

  constructor() {
    this.settingsService
      .getSettings()
      .pipe(
        finalize(() => {
          this.loading.set(false);
          this.paramsLoading.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (settings) => {
          this.promptForm.controls.prompt.enable();
          this.paramsForm.enable();
          this.applyPrompt(settings.prompt_extension);
          this.applyParams(settings.parameters);
        },
        error: (err: HttpErrorResponse) => {
          this.promptForm.controls.prompt.enable();
          this.paramsForm.enable();
          this.notifications.error(
            'Не удалось загрузить настройки: ' + extractApiErrorMessage(err)
          );
        }
      });
  }

  save(): void {
    if (!this.canSave()) {
      return;
    }

    const prompt = this.promptForm.controls.prompt.getRawValue();
    this.saving.set(true);
    this.settingsService
      .updateSettings({ prompt_extension: prompt })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (settings) => {
          this.applyPrompt(settings.prompt_extension);
          this.notifications.success('Системный промпт сохранён');
        },
        error: (err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось сохранить системный промпт: ' + extractApiErrorMessage(err)
          );
        }
      });
  }

  private applyPrompt(prompt: string): void {
    this.promptForm.controls.prompt.setValue(prompt);
    this.promptForm.controls.prompt.markAsPristine();
    this.promptForm.controls.prompt.markAsUntouched();
  }

  saveParams(): void {
    if (!this.canSaveParams()) {
      return;
    }

    const {
      laser_speed_m_per_hour,
      welding_speed_m_per_hour,
      bending_rate_per_hour,
      painting_rate_m2_per_hour
    } = this.paramsForm.getRawValue();
    this.savingParams.set(true);
    this.settingsService
      .updateSettings({
        parameters: {
          laser_speed_m_per_hour: Number(laser_speed_m_per_hour),
          welding_speed_m_per_hour: Number(welding_speed_m_per_hour),
          bending_rate_per_hour: Number(bending_rate_per_hour),
          painting_rate_m2_per_hour: Number(painting_rate_m2_per_hour)
        }
      })
      .pipe(finalize(() => this.savingParams.set(false)))
      .subscribe({
        next: (settings) => {
          this.applyParams(settings.parameters);
          this.notifications.success('Параметры станков сохранены');
        },
        error: (err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось сохранить параметры станков: ' + extractApiErrorMessage(err)
          );
        }
      });
  }

  private applyParams(params: MachineParameters): void {
    this.paramsForm.setValue({
      laser_speed_m_per_hour: String(params.laser_speed_m_per_hour),
      welding_speed_m_per_hour: String(params.welding_speed_m_per_hour),
      bending_rate_per_hour: String(params.bending_rate_per_hour),
      painting_rate_m2_per_hour: String(params.painting_rate_m2_per_hour)
    });
    this.paramsForm.markAsPristine();
    this.paramsForm.markAsUntouched();
  }
}

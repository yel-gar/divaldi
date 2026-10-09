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
import { AdminSettingsService } from '../../../core/services/admin-settings.service';
import { NotificationService } from '../../../core/services/notification.service';
import { extractApiErrorMessage } from '../../../shared/utils/api-error';

const MAX_SYSTEM_PROMPT_LENGTH = 20000;
const COUNTER_VISIBLE_FROM = 15000;

@Component({
  selector: 'app-admin-settings-page',
  imports: [ReactiveFormsModule, Textarea],
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

  readonly MAX_SYSTEM_PROMPT_LENGTH = MAX_SYSTEM_PROMPT_LENGTH;
  readonly COUNTER_VISIBLE_FROM = COUNTER_VISIBLE_FROM;

  readonly promptForm = this.fb.group({
    prompt: this.fb.control({ value: '', disabled: true }, [
      Validators.maxLength(MAX_SYSTEM_PROMPT_LENGTH)
    ])
  });

  private readonly promptValue = toSignal(this.promptForm.controls.prompt.valueChanges, {
    initialValue: ''
  });

  readonly canSave = computed(() => {
    const value = this.promptValue();
    const control = this.promptForm.controls.prompt;
    return control.enabled && control.dirty && value.length > 0 && !this.saving();
  });

  constructor() {
    this.settingsService
      .getSystemPrompt()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ prompt }) => {
          this.promptForm.controls.prompt.enable();
          this.applyPrompt(prompt);
        },
        error: (err: HttpErrorResponse) => {
          this.promptForm.controls.prompt.enable();
          this.notifications.error(
            'Не удалось загрузить системный промпт: ' + extractApiErrorMessage(err)
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
      .updateSystemPrompt(prompt)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: ({ prompt: saved }) => {
          this.applyPrompt(saved);
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
}

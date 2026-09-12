import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideEye, LucideEyeOff, LucideLock, LucideUser } from '@lucide/angular';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { extractApiErrorMessage } from '../../shared/utils/api-error';
import { InputComponent } from '../../shared/components/input/input.component';

const USERNAME_MAX_LENGTH = 32;

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, InputComponent],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly userIcon = LucideUser;
  readonly lockIcon = LucideLock;
  readonly eyeIcon = LucideEye;
  readonly eyeOffIcon = LucideEyeOff;

  readonly form = this.fb.group({
    username: ['', [Validators.required, Validators.maxLength(USERNAME_MAX_LENGTH)]],
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(PASSWORD_MIN_LENGTH),
        Validators.maxLength(PASSWORD_MAX_LENGTH)
      ]
    ]
  });

  readonly isSubmitting = signal(false);
  readonly showPassword = signal(false);

  private readonly returnUrl = this.route.snapshot.queryParamMap.get('return')?.startsWith('/')
    ? this.route.snapshot.queryParamMap.get('return')
    : '/create';

  togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  submit(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.clearCredentialsError();

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      const { username, password } = this.form.controls;
      if (username.hasError('required') || password.hasError('required')) {
        this.notifications.error('Заполните логин и пароль');
      } else if (password.hasError('minlength')) {
        this.notifications.error('Пароль должен быть не короче 8 символов');
      } else if (username.hasError('maxlength')) {
        this.notifications.error('Логин не может быть длиннее 32 символов');
      } else {
        this.notifications.error('Пароль не может быть длиннее 128 символов');
      }
      return;
    }

    this.isSubmitting.set(true);
    const { username, password } = this.form.getRawValue();
    this.auth.login(username?.trim() ?? '', password ?? '').subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.notifications.success('Вы вошли в систему');
        this.router.navigate([this.returnUrl]);
      },
      error: (err: HttpErrorResponse) => {
        this.isSubmitting.set(false);
        this.showCredentialsError();

        if (err.status === 401) {
          this.notifications.error('Перепроверьте правильность введённого логина и пароля');
          return;
        }

        this.notifications.error('Не удалось войти: ' + extractApiErrorMessage(err));
      }
    });
  }

  private clearCredentialsError(): void {
    for (const control of [this.form.controls.username, this.form.controls.password]) {
      if (!control.hasError('credentials')) {
        continue;
      }
      const errors = { ...control.errors };
      delete errors['credentials'];
      control.setErrors(Object.keys(errors).length ? errors : null);
    }
  }

  private showCredentialsError(): void {
    for (const control of [this.form.controls.username, this.form.controls.password]) {
      control.setErrors({ ...(control.errors ?? {}), credentials: true });
      control.markAsTouched();
    }
  }
}

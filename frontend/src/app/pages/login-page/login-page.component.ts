import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideEye, LucideEyeOff, LucideLock, LucideMail } from '@lucide/angular';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { InputComponent } from '../../shared/components/input/input.component';
import { CheckboxComponent } from '../../shared/components/checkbox/checkbox.component';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, InputComponent, CheckboxComponent],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  readonly mailIcon = LucideMail;
  readonly lockIcon = LucideLock;
  readonly eyeIcon = LucideEye;
  readonly eyeOffIcon = LucideEyeOff;

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    rememberMe: [false]
  });

  readonly isSubmitting = signal(false);
  readonly showPassword = signal(false);

  togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.error('Заполните email и пароль');
      return;
    }

    this.isSubmitting.set(true);
    const { email, password } = this.form.getRawValue();
    this.auth.login(email ?? '', password ?? '').subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.notifications.success('Вы вошли в систему');
        this.router.navigate(['/create']);
      },
      error: (err: { message?: string }) => {
        this.isSubmitting.set(false);
        this.notifications.error('Не удалось войти: ' + (err.message ?? 'Ошибка сервера'));
      }
    });
  }
}

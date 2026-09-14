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
import { finalize } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucideCalendar,
  LucideEye,
  LucideEyeOff,
  LucidePencil,
  LucidePlus,
  LucideSearch,
  LucideTrash2
} from '@lucide/angular';
import { AdminUser, AdminUserPayload } from '../../../core/models/models';
import { AdminUsersService } from '../../../core/services/admin-users.service';
import { NotificationService } from '../../../core/services/notification.service';
import { extractApiErrorMessage } from '../../../shared/utils/api-error';
import { InputComponent } from '../../../shared/components/input/input.component';
import { Spinner } from '../../../shared/components/spinner/spinner.component';

type UserStatus = 'active' | 'expiring' | 'expired';

const EXPIRING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function localDateInputValue(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

@Component({
  selector: 'app-users-page',
  imports: [ReactiveFormsModule, InputComponent, Spinner, LucidePlus, LucidePencil, LucideTrash2],
  templateUrl: './users-page.component.html',
  styleUrl: './users-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UsersPage {
  private readonly adminUsersService = inject(AdminUsersService);
  private readonly notifications = inject(NotificationService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly users = signal<AdminUser[]>([]);
  readonly search = signal('');
  readonly selectedUser = signal<AdminUser | null>(null);
  readonly isSubmitting = signal(false);
  readonly deletingId = signal<number | null>(null);
  readonly showPassword = signal(false);

  readonly filteredUsers = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.users();
    }
    return this.users().filter((user) =>
      [user.username, user.first_name, user.last_name]
        .filter((value): value is string => value !== null)
        .some((value) => value.toLowerCase().includes(query))
    );
  });

  readonly isEditMode = computed(() => this.selectedUser() !== null);

  readonly userForm = this.fb.group({
    first_name: ['', [Validators.required, Validators.maxLength(60)]],
    last_name: ['', [Validators.required, Validators.maxLength(60)]],
    username: ['', [Validators.required, Validators.maxLength(32)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    expires_at: ['']
  });

  readonly searchIcon = LucideSearch;
  readonly calendarIcon = LucideCalendar;
  readonly eyeIcon = LucideEye;
  readonly eyeOffIcon = LucideEyeOff;

  constructor() {
    this.adminUsersService
      .list()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (users) => this.users.set(users),
        error: (err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось загрузить пользователей: ' + extractApiErrorMessage(err)
          );
        }
      });
  }

  selectUser(user: AdminUser): void {
    this.selectedUser.set(user);
    this.showPassword.set(false);
    this.userForm.setValue({
      first_name: user.first_name ?? '',
      last_name: user.last_name ?? '',
      username: user.username,
      password: '',
      expires_at: user.expires_at ? localDateInputValue(user.expires_at) : ''
    });
    this.updatePasswordValidators();
  }

  resetForm(): void {
    this.selectedUser.set(null);
    this.showPassword.set(false);
    this.userForm.reset();
    this.updatePasswordValidators();
  }

  togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  userStatus(user: AdminUser): UserStatus {
    if (!user.expires_at) {
      return 'active';
    }
    const expires = new Date(user.expires_at).getTime();
    const now = Date.now();
    if (expires <= now) {
      return 'expired';
    }
    if (expires <= now + EXPIRING_SOON_DAYS * DAY_MS) {
      return 'expiring';
    }
    return 'active';
  }

  statusLabel(status: UserStatus): string {
    if (status === 'expired') {
      return 'Неактивен';
    }
    return status === 'expiring' ? 'Истекает' : 'Активен';
  }

  fullName(user: AdminUser): string {
    return [user.first_name, user.last_name].filter(Boolean).join(' ') || '—';
  }

  initials(user: AdminUser): string {
    const fromNames = ((user.first_name?.[0] ?? '') + (user.last_name?.[0] ?? '')).toUpperCase();
    return fromNames || user.username.slice(0, 2).toUpperCase();
  }

  submit(): void {
    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      this.notifications.error('Заполните все обязательные поля');
      return;
    }

    const selected = this.selectedUser();
    const { first_name, last_name, username, password, expires_at } = this.userForm.getRawValue();

    if (!selected) {
      this.sendCreate({
        username: username.trim(),
        password,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        expires_at: expires_at ? new Date(`${expires_at}T00:00:00`).toISOString() : null
      });
      return;
    }

    const payload: Partial<AdminUserPayload> = {};
    if (username.trim() !== selected.username) {
      payload.username = username.trim();
    }
    if (first_name.trim() !== (selected.first_name ?? '')) {
      payload.first_name = first_name.trim();
    }
    if (last_name.trim() !== (selected.last_name ?? '')) {
      payload.last_name = last_name.trim();
    }
    const storedExpiry = selected.expires_at ? localDateInputValue(selected.expires_at) : '';
    if (expires_at !== storedExpiry) {
      payload.expires_at = expires_at ? new Date(`${expires_at}T00:00:00`).toISOString() : null;
    }

    if (!Object.keys(payload).length && !password) {
      this.notifications.info('Нет изменений');
      return;
    }

    this.isSubmitting.set(true);
    this.adminUsersService
      .edit(selected.id, payload)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (updated) => {
          this.users.update((list) =>
            list.map((item) => (item.id === updated.id ? updated : item))
          );
          if (!password) {
            this.notifications.success('Пользователь обновлён');
            this.resetForm();
            return;
          }
          this.adminUsersService.setPassword(selected.id, password).subscribe({
            next: () => {
              this.notifications.success('Пользователь обновлён');
              this.resetForm();
            },
            error: (err: HttpErrorResponse) => {
              this.notifications.error(
                'Профиль сохранён, но пароль изменить не удалось: ' + extractApiErrorMessage(err)
              );
              this.resetForm();
            }
          });
        },
        error: (err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось сохранить пользователя: ' + extractApiErrorMessage(err)
          );
        }
      });
  }

  private sendCreate(payload: AdminUserPayload): void {
    this.isSubmitting.set(true);
    this.adminUsersService
      .create(payload)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (user) => {
          this.notifications.success('Пользователь создан');
          this.users.update((list) => [...list, user]);
          this.resetForm();
        },
        error: (err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось создать пользователя: ' + extractApiErrorMessage(err)
          );
        }
      });
  }

  deleteUser(user: AdminUser): void {
    if (this.deletingId() !== null) {
      return;
    }
    if (!window.confirm(`Удалить пользователя ${user.username}?`)) {
      return;
    }
    this.deletingId.set(user.id);
    this.adminUsersService
      .remove(user.id)
      .pipe(finalize(() => this.deletingId.set(null)))
      .subscribe({
        next: () => {
          this.users.update((list) => list.filter((item) => item.id !== user.id));
          if (this.selectedUser()?.id === user.id) {
            this.resetForm();
          }
          this.notifications.success('Пользователь удалён');
        },
        error: (err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось удалить пользователя: ' + extractApiErrorMessage(err)
          );
        }
      });
  }

  private updatePasswordValidators(): void {
    const passwordControl = this.userForm.controls.password;
    passwordControl.setValidators(
      this.isEditMode()
        ? [Validators.minLength(8), Validators.maxLength(128)]
        : [Validators.required, Validators.minLength(8), Validators.maxLength(128)]
    );
    passwordControl.updateValueAndValidity();
  }
}

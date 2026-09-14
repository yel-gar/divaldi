import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { extractApiErrorMessage } from '../../shared/utils/api-error';
import { SKIP_AUTH_ERROR_HANDLING } from './skip-auth-error-handling';

@Injectable({ providedIn: 'root' })
class ErrorRedirectState {
  readonly redirectingToLogin = signal(false);
}

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);
  const redirectState = inject(ErrorRedirectState);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (req.url.endsWith('/auth/login') || req.context.get(SKIP_AUTH_ERROR_HANDLING)) {
        return throwError(() => error);
      }

      const message = extractApiErrorMessage(error);

      if (error.status === 401) {
        if (!redirectState.redirectingToLogin() && !router.url.startsWith('/login')) {
          redirectState.redirectingToLogin.set(true);
          notifications.error('Вы не авторизованы');
          router.navigate(['/login']).finally(() => redirectState.redirectingToLogin.set(false));
        }
        return throwError(() => error);
      }

      if (error.status >= 500) {
        notifications.errorOnce('Ошибка сервера');
      } else {
        notifications.errorOnce(message);
      }

      return throwError(() => error);
    })
  );
};

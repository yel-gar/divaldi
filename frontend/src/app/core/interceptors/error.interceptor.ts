import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { extractApiErrorMessage } from '../../shared/utils/api-error';
import { SKIP_AUTH_ERROR_HANDLING } from './skip-auth-error-handling';

let redirectingToLogin = false;

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (req.url.endsWith('/auth/login') || req.context.get(SKIP_AUTH_ERROR_HANDLING)) {
        return throwError(() => error);
      }

      const message = extractApiErrorMessage(error);

      if (error.status === 401) {
        if (!redirectingToLogin && !router.url.startsWith('/login')) {
          redirectingToLogin = true;
          notifications.error('Вы не авторизованы');
          router.navigate(['/login']).finally(() => {
            redirectingToLogin = false;
          });
        }
        return throwError(() => error);
      }

      switch (error.status) {
        case 0:
          notifications.error('Не удалось связаться с сервером');
          break;
        case 403:
          notifications.error('Доступ запрещен');
          break;
        case 404:
          notifications.error('Ресурс не найден');
          break;
        default:
          if (error.status >= 500) {
            notifications.error('Ошибка сервера');
          } else {
            notifications.error(message);
          }
      }

      return throwError(() => error);
    })
  );
};

import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const message = error.error?.message || error.message || 'Неизвестная ошибка';

      switch (error.status) {
        case 0:
          notifications.error('Не удалось связаться с сервером');
          break;
        case 401:
          notifications.error('Вы не авторизованы');
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

import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const message = error.error?.message || error.message || 'Неизвестная ошибка';

      if (error.status === 0) {
        notifications.error('Не удалось связаться с сервером');
      } else if (error.status === 401) {
        notifications.error('Вы не авторизованы');
      } else if (error.status === 403) {
        notifications.error('Доступ запрещен');
      } else if (error.status === 404) {
        notifications.error('Ресурс не найден');
      } else if (error.status >= 500) {
        notifications.error('Ошибка сервера');
      } else {
        notifications.error(message);
      }

      return throwError(() => error);
    })
  );
};

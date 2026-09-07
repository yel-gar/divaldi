import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const message = error.error?.message || error.message || 'Unknown error';

      if (error.status === 0) {
        notifications.error('Cannot connect to server');
      } else if (error.status === 401) {
        notifications.error('Unauthorized');
      } else if (error.status === 403) {
        notifications.error('Access denied');
      } else if (error.status === 404) {
        notifications.error('Not found');
      } else if (error.status >= 500) {
        notifications.error('Server error');
      } else {
        notifications.error(message);
      }

      return throwError(() => error);
    })
  );
};

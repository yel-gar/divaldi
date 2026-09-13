import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { NotificationService } from '../services/notification.service';
import { ProfileService } from '../services/profile.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const profile = inject(ProfileService);
  const router = inject(Router);

  if (profile.user()) {
    return true;
  }

  return profile.fetchMe().pipe(
    map(() => true),
    catchError(() => of(router.createUrlTree(['/login'], { queryParams: { return: state.url } })))
  );
};

export const adminGuard: CanActivateFn = () => {
  const profile = inject(ProfileService);
  const router = inject(Router);

  const user = profile.user();
  if (!user) {
    return router.createUrlTree(['/login']);
  }
  return user.is_superuser ? true : router.createUrlTree(['/create']);
};

export const publicGuard: CanActivateFn = () => {
  const profile = inject(ProfileService);
  const router = inject(Router);
  const notifications = inject(NotificationService);

  if (profile.user()) {
    notifications.info('Вы уже авторизованы');
    return router.createUrlTree(['/create']);
  }

  return profile.fetchMe().pipe(
    map(() => {
      notifications.info('Вы уже авторизованы');
      return router.createUrlTree(['/create']);
    }),
    catchError(() => of(true))
  );
};

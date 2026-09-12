import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
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

  return profile.user()?.is_superuser ? true : router.createUrlTree(['/create']);
};

export const publicGuard: CanActivateFn = () => {
  const profile = inject(ProfileService);
  const router = inject(Router);

  if (profile.user()) {
    return router.createUrlTree(['/create']);
  }

  return profile.fetchMe().pipe(
    map(() => router.createUrlTree(['/create'])),
    catchError(() => of(true))
  );
};

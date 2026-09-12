import { Injectable, inject, signal } from '@angular/core';
import { HttpContext, HttpClient } from '@angular/common/http';
import { Observable, finalize, share, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User } from '../models/models';
import { SKIP_AUTH_ERROR_HANDLING } from '../interceptors/skip-auth-error-handling';

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  private readonly http = inject(HttpClient);

  readonly user = signal<User | null>(null);
  private meRequest$: Observable<User> | null = null;

  fetchMe(): Observable<User> {
    if (this.meRequest$) {
      return this.meRequest$;
    }

    const context = new HttpContext().set(SKIP_AUTH_ERROR_HANDLING, true);
    this.meRequest$ = this.http.get<User>(`${environment.apiUrl}/users/me`, { context }).pipe(
      tap((user) => this.user.set(user)),
      finalize(() => (this.meRequest$ = null)),
      share()
    );
    return this.meRequest$;
  }

  clear(): void {
    this.user.set(null);
  }
}

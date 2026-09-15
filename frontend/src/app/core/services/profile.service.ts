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
  private requestGeneration = 0;

  fetchMe(): Observable<User> {
    if (this.meRequest$) {
      return this.meRequest$;
    }

    const generation = this.requestGeneration;
    const context = new HttpContext().set(SKIP_AUTH_ERROR_HANDLING, true);
    const request = this.http.get<User>(`${environment.apiUrl}/users/me`, { context }).pipe(
      tap((user) => {
        if (generation === this.requestGeneration) {
          this.user.set(user);
        }
      }),
      finalize(() => {
        if (this.meRequest$ === request) {
          this.meRequest$ = null;
        }
      }),
      share()
    );
    this.meRequest$ = request;
    return request;
  }

  clear(): void {
    this.requestGeneration++;
    this.meRequest$ = null;
    this.user.set(null);
  }
}

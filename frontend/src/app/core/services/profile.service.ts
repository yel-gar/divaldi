import { Injectable, inject, signal } from '@angular/core';
import { HttpContext, HttpClient } from '@angular/common/http';
import { Observable, finalize, share, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { S3AvatarUrl, User } from '../models/models';
import { SKIP_AUTH_ERROR_HANDLING } from '../interceptors/skip-auth-error-handling';

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  private readonly http = inject(HttpClient);

  readonly user = signal<User | null>(null);
  readonly avatarUrl = signal<string | null>(null);
  readonly avatarLoading = signal(true);
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

  loadAvatar(): void {
    const context = new HttpContext().set(SKIP_AUTH_ERROR_HANDLING, true);
    this.http
      .get<S3AvatarUrl>(`${environment.apiUrl}/users/me/avatar`, { context })
      .pipe(finalize(() => this.avatarLoading.set(false)))
      .subscribe({
        next: (response) => this.avatarUrl.set(response.avatar_url),
        error: () => this.avatarUrl.set(null)
      });
  }

  clear(): void {
    this.requestGeneration++;
    this.meRequest$ = null;
    this.user.set(null);
    this.avatarUrl.set(null);
    this.avatarLoading.set(true);
  }
}

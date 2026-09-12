import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/auth`;

  login(username: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/login`, {
      username,
      password
    });
  }

  logout(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/logout`, {});
  }
}

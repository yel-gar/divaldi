import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AdminUser, AdminUserPayload } from '../models/models';

@Injectable({
  providedIn: 'root'
})
export class AdminUsersService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/admin/users`;

  list(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>(this.baseUrl);
  }

  create(payload: AdminUserPayload): Observable<AdminUser> {
    return this.http.post<AdminUser>(this.baseUrl, payload);
  }

  edit(id: number, payload: Partial<AdminUserPayload>): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`${this.baseUrl}/${id}`, payload);
  }

  setPassword(id: number, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/${id}/set-password`, { password });
  }

  remove(id: number): Observable<AdminUser> {
    return this.http.delete<AdminUser>(`${this.baseUrl}/${id}`);
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  get<T>(url: string): Promise<T> {
    return this.http
      .get<T>(`${this.baseUrl}${url}`)
      .toPromise()
      .then((res) => res as T)
      .catch(this.handleError);
  }

  post<T>(url: string, body?: unknown): Promise<T> {
    return this.http
      .post<T>(`${this.baseUrl}${url}`, body)
      .toPromise()
      .then((res) => res as T)
      .catch(this.handleError);
  }

  put<T>(url: string, body?: unknown): Promise<T> {
    return this.http
      .put<T>(`${this.baseUrl}${url}`, body)
      .toPromise()
      .then((res) => res as T)
      .catch(this.handleError);
  }

  delete<T>(url: string): Promise<T> {
    return this.http
      .delete<T>(`${this.baseUrl}${url}`)
      .toPromise()
      .then((res) => res as T)
      .catch(this.handleError);
  }

  private handleError(error: HttpErrorResponse): never {
    const message = error.error?.message || error.message || 'Unknown API error';
    throw new Error(message);
  }
}

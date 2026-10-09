import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SystemPromptSchema } from '../models/models';

@Injectable({
  providedIn: 'root'
})
export class AdminSettingsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/admin/system-prompt`;

  getSystemPrompt(): Observable<SystemPromptSchema> {
    return this.http.get<SystemPromptSchema>(this.baseUrl);
  }

  updateSystemPrompt(prompt: string): Observable<SystemPromptSchema> {
    return this.http.put<SystemPromptSchema>(this.baseUrl, { prompt });
  }
}

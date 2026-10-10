import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { credentialsInterceptor } from './core/interceptors/credentials.interceptor';
import { mockApiInterceptor } from './core/interceptors/mock-api.interceptor';

const interceptors = environment.useMocks
  ? [mockApiInterceptor, credentialsInterceptor, errorInterceptor]
  : [credentialsInterceptor, errorInterceptor];

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors(interceptors))
  ]
};

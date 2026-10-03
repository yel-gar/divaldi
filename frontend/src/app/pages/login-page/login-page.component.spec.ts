import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, Routes } from '@angular/router';

import { LoginPageComponent } from './login-page.component';
import { NotificationsComponent } from '../../shared/components/notifications/notifications.component';
import { environment } from '../../../environments/environment';

const LOGIN_URL = `${environment.apiUrl}/auth/login`;

@Component({ selector: 'app-blank', template: '' })
class BlankComponent {}

const TEST_ROUTES: Routes = [
  { path: 'create', component: BlankComponent },
  { path: 'chats/:id', component: BlankComponent }
];

@Component({
  selector: 'app-login-test-host',
  imports: [LoginPageComponent, NotificationsComponent],
  template: `<app-notifications /><app-login-page />`
})
class TestHost {}

describe('LoginPageComponent', () => {
  let fixture: ComponentFixture<TestHost>;
  let router: Router;
  let http: HttpTestingController;

  const page = () =>
    fixture.debugElement.query(By.directive(LoginPageComponent))
      .componentInstance as LoginPageComponent;
  const usernameInput = () =>
    fixture.debugElement.query(By.css('#username')).nativeElement as HTMLInputElement;
  const passwordInput = () =>
    fixture.debugElement.query(By.css('#password')).nativeElement as HTMLInputElement;
  const submitButton = () =>
    fixture.debugElement.query(By.css('button[type="submit"]')).nativeElement as HTMLButtonElement;
  const notificationTitle = () => fixture.debugElement.query(By.css('.notification__title'));
  const notificationText = () => notificationTitle()?.nativeElement.textContent ?? '';

  const createPage = (): void => {
    fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
  };

  const type = (input: HTMLInputElement, value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const fillCredentials = (username: string, password: string): void => {
    type(usernameInput(), username);
    type(passwordInput(), password);
  };

  const submitForm = (): void => {
    fixture.debugElement.query(By.css('form')).triggerEventHandler('submit', new Event('submit'));
    fixture.detectChanges();
  };

  const flushLogin = (body: object | null, status = 200): void => {
    http.expectOne(LOGIN_URL).flush(body, { status, statusText: status === 200 ? 'OK' : 'Error' });
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideRouter(TEST_ROUTES), provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  describe('rendering', () => {
    it('renders the login form with the Russian labels and an enabled submit button', () => {
      createPage();

      expect(fixture.nativeElement.textContent).toContain('Вход в аккаунт');
      expect(
        fixture.debugElement.query(By.css('label[for="username"]')).nativeElement.textContent
      ).toContain('Логин');
      expect(
        fixture.debugElement.query(By.css('label[for="password"]')).nativeElement.textContent
      ).toContain('Пароль');
      expect(submitButton().textContent.trim()).toBe('Войти');
      expect(submitButton().disabled).toBe(false);
      expect(page().form.controls.username.value).toBe('');
      expect(page().form.controls.password.value).toBe('');
    });

    it('switches the password field between masked and plain text', () => {
      createPage();
      expect(passwordInput().type).toBe('password');

      page().togglePassword();
      fixture.detectChanges();
      expect(page().showPassword()).toBe(true);
      expect(passwordInput().type).toBe('text');

      page().togglePassword();
      fixture.detectChanges();
      expect(page().showPassword()).toBe(false);
      expect(passwordInput().type).toBe('password');
    });
  });

  describe('successful login', () => {
    it('posts the credentials and navigates to the create page', async () => {
      createPage();
      fillCredentials('ivan', 'password123');
      submitForm();

      const req = http.expectOne(LOGIN_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ username: 'ivan', password: 'password123' });

      req.flush({ message: 'ok' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(router.url).toBe('/create');
      expect(page().isSubmitting()).toBe(false);
      expect(notificationText()).toBe('Вы вошли в систему');
    });

    it('trims the username before sending it', async () => {
      createPage();
      fillCredentials('  ivan  ', 'password123');
      submitForm();

      const req = http.expectOne(LOGIN_URL);
      expect(req.request.body).toEqual({ username: 'ivan', password: 'password123' });

      req.flush({ message: 'ok' });
      await fixture.whenStable();
    });

    it('disables the submit button while the request is in flight', async () => {
      createPage();
      fillCredentials('ivan', 'password123');
      submitForm();

      const req = http.expectOne(LOGIN_URL);
      expect(submitButton().disabled).toBe(true);
      expect(page().isSubmitting()).toBe(true);

      req.flush({ message: 'ok' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(submitButton().disabled).toBe(false);
    });

    it('ignores a second submit while the first request is in flight', () => {
      createPage();
      fillCredentials('ivan', 'password123');
      submitForm();
      http.expectOne(LOGIN_URL);

      page().submit();

      http.expectNone(LOGIN_URL);
    });

    it('navigates to the page requested through the return query param', async () => {
      await router.navigateByUrl('/create?return=%2Fchats%2Fabc');
      createPage();
      fillCredentials('ivan', 'password123');
      submitForm();
      http.expectOne(LOGIN_URL).flush({ message: 'ok' });
      await fixture.whenStable();

      expect(router.url).toBe('/chats/abc');
    });

    it('falls back to the create page for a protocol-relative return url', async () => {
      await router.navigateByUrl('/create?return=//evil.example');
      createPage();
      fillCredentials('ivan', 'password123');
      submitForm();
      http.expectOne(LOGIN_URL).flush({ message: 'ok' });
      await fixture.whenStable();

      expect(router.url).toBe('/create');
    });

    it('falls back to the create page for a return url without a leading slash', async () => {
      await router.navigateByUrl('/create?return=chats%2Fabc');
      createPage();
      fillCredentials('ivan', 'password123');
      submitForm();
      http.expectOne(LOGIN_URL).flush({ message: 'ok' });
      await fixture.whenStable();

      expect(router.url).toBe('/create');
    });
  });

  describe('failed login', () => {
    it('shows the wrong credentials message and marks both fields on 401', async () => {
      createPage();
      fillCredentials('ivan', 'wrong-password');
      submitForm();
      flushLogin({ detail: 'Неверные данные' }, 401);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(notificationText()).toBe('Перепроверьте правильность введённого логина и пароля');
      expect(page().form.controls.username.hasError('credentials')).toBe(true);
      expect(page().form.controls.password.hasError('credentials')).toBe(true);
      expect(page().isSubmitting()).toBe(false);
      expect(submitButton().disabled).toBe(false);
      expect(router.url).not.toBe('/chats/abc');
    });

    it('clears the credentials error when the form is submitted again', async () => {
      createPage();
      fillCredentials('ivan', 'wrong-password');
      submitForm();
      flushLogin({ detail: 'Неверные данные' }, 401);
      await fixture.whenStable();
      expect(page().form.controls.password.hasError('credentials')).toBe(true);

      type(passwordInput(), 'password123');
      page().submit();

      expect(page().form.controls.username.hasError('credentials')).toBe(false);
      expect(page().form.controls.password.hasError('credentials')).toBe(false);
      http.expectOne(LOGIN_URL).flush({ message: 'ok' });
      await fixture.whenStable();
    });

    it('marks the inputs as invalid and swaps the credentials error for the validator one on edit', async () => {
      createPage();
      fillCredentials('ivan', 'wrong-password');
      submitForm();
      flushLogin({ detail: 'Неверные данные' }, 401);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('app-input')).nativeElement.classList).toContain(
        'input--error'
      );

      type(passwordInput(), 'short');

      expect(page().form.controls.password.hasError('credentials')).toBe(false);
      expect(page().form.controls.password.hasError('minlength')).toBe(true);
    });

    it('surfaces the server error message on 500', async () => {
      createPage();
      fillCredentials('ivan', 'password123');
      submitForm();
      flushLogin(null, 500);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(notificationText()).toBe('Не удалось войти: Ошибка сервера');
      expect(router.url).not.toBe('/chats/abc');
    });

    it('surfaces the API detail message on 403', async () => {
      createPage();
      fillCredentials('ivan', 'password123');
      submitForm();
      flushLogin({ detail: 'Пользователь заблокирован' }, 403);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(notificationText()).toBe('Не удалось войти: Пользователь заблокирован');
    });

    it('reports an unreachable server when the request never leaves', async () => {
      createPage();
      fillCredentials('ivan', 'password123');
      submitForm();
      flushLogin(null, 0);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(notificationText()).toBe('Не удалось войти: Не удалось связаться с сервером');
    });
  });

  describe('client-side validation', () => {
    it('asks for both fields when the form is empty', () => {
      createPage();
      submitForm();

      expect(notificationText()).toBe('Заполните логин и пароль');
      expect(page().form.controls.username.touched).toBe(true);
      expect(page().form.controls.password.touched).toBe(true);
      http.expectNone(LOGIN_URL);
    });

    it('rejects a password shorter than 8 characters', () => {
      createPage();
      fillCredentials('ivan', 'short');
      submitForm();

      expect(notificationText()).toBe('Пароль должен быть не короче 8 символов');
      http.expectNone(LOGIN_URL);
    });

    it('rejects a username longer than 32 characters', () => {
      createPage();
      fillCredentials('i'.repeat(33), 'password123');
      submitForm();

      expect(notificationText()).toBe('Логин не может быть длиннее 32 символов');
      http.expectNone(LOGIN_URL);
    });

    it('rejects a password longer than 128 characters', () => {
      createPage();
      fillCredentials('ivan', 'p'.repeat(129));
      submitForm();

      expect(notificationText()).toBe('Пароль не может быть длиннее 128 символов');
      http.expectNone(LOGIN_URL);
    });
  });
});

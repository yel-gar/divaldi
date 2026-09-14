import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';

import { UsersPage } from './users-page.component';
import { environment } from '../../../../environments/environment';

const USERS = [
  {
    id: 1,
    username: 'admin',
    first_name: null,
    last_name: null,
    is_superuser: true,
    expires_at: null
  },
  {
    id: 2,
    username: 'ivanov',
    first_name: 'Иван',
    last_name: 'Иванов',
    is_superuser: false,
    expires_at: '2100-01-01T00:00:00Z'
  },
  {
    id: 3,
    username: 'petrov',
    first_name: 'Пётр',
    last_name: 'Петров',
    is_superuser: false,
    expires_at: '2000-01-01T00:00:00Z'
  }
];

const UPDATED_IVANOV = { ...USERS[1], first_name: 'Иван' };

const CREATED_USER = {
  id: 4,
  username: 'sidorov',
  first_name: 'Сидор',
  last_name: 'Сидоров',
  is_superuser: false,
  expires_at: null
};

describe('UsersPage', () => {
  let fixture: ComponentFixture<UsersPage>;
  let component: UsersPage;
  let http: HttpTestingController;

  const rows = () => fixture.debugElement.queryAll(By.css('tbody tr'));

  const createPage = (): void => {
    fixture = TestBed.createComponent(UsersPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/admin/users`).flush(USERS);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('renders users with statuses and total count', () => {
    createPage();

    expect(rows().length).toBe(3);
    expect(rows()[0].nativeElement.textContent).toContain('admin');
    expect(rows()[0].nativeElement.textContent).toContain('AD');
    expect(
      (rows()[1].nativeElement as HTMLElement).querySelector('.badge--success')
    ).not.toBeNull();
    expect(rows()[1].nativeElement.textContent).toContain('Иван Иванов');
    expect((rows()[2].nativeElement as HTMLElement).querySelector('.badge--muted')).not.toBeNull();
  });

  it('filters users by search query', () => {
    createPage();

    const searchInput = fixture.debugElement.query(By.css('#user-search')).nativeElement;
    searchInput.value = 'ivan';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(rows().length).toBe(1);
    expect(rows()[0].nativeElement.textContent).toContain('ivanov');
  });

  it('fills the form with user data on edit', () => {
    createPage();

    const editButtons = fixture.debugElement.queryAll(
      By.css('.users-table__action:not(.users-table__action--danger)')
    );
    editButtons[1].nativeElement.click();
    fixture.detectChanges();

    const formValue = component.userForm.getRawValue();
    expect(formValue.username).toBe('ivanov');
    expect(formValue.first_name).toBe('Иван');
    expect(formValue.expires_at).toBe('2100-01-01');
    expect(
      fixture.debugElement.query(By.css('.users-card__title')).nativeElement.textContent
    ).toContain('Редактирование пользователя');
  });

  it('patches only changed fields and sets password on save in edit mode', () => {
    createPage();
    component.selectUser(USERS[1]);
    component.userForm.controls.password.setValue('newpassword1');
    component.userForm.controls.expires_at.setValue('');
    fixture.detectChanges();

    component.submit();

    const patchReq = http.expectOne(`${environment.apiUrl}/admin/users/2`);
    expect(patchReq.request.method).toBe('PATCH');
    expect(patchReq.request.body).toEqual({ expires_at: null });
    patchReq.flush(UPDATED_IVANOV);

    const passwordReq = http.expectOne(`${environment.apiUrl}/admin/users/2/set-password`);
    expect(passwordReq.request.method).toBe('POST');
    expect(passwordReq.request.body).toEqual({ password: 'newpassword1' });
    passwordReq.flush({ message: 'Password changed successfully' });

    expect(component.users().length).toBe(3);
    expect(component.users()[1].first_name).toBe('Иван');
  });

  it('sends the username when it changes', () => {
    createPage();
    component.selectUser(USERS[1]);
    component.userForm.controls.username.setValue('ivanov2');

    component.submit();

    const patchReq = http.expectOne(`${environment.apiUrl}/admin/users/2`);
    expect(patchReq.request.body).toEqual({ username: 'ivanov2' });
    patchReq.flush({ ...USERS[1], username: 'ivanov2' });

    expect(component.users()[1].username).toBe('ivanov2');
  });

  it('skips the request when nothing changed', () => {
    createPage();
    component.selectUser(USERS[1]);

    component.submit();

    http.expectNone((req) => req.method === 'PATCH');
  });

  it('creates a user from the form', () => {
    createPage();
    component.userForm.setValue({
      first_name: 'Сидор',
      last_name: 'Сидоров',
      username: 'sidorov',
      password: 'password123',
      expires_at: ''
    });

    component.submit();

    const createReq = http.expectOne(`${environment.apiUrl}/admin/users`);
    expect(createReq.request.method).toBe('POST');
    expect(createReq.request.body).toEqual({
      username: 'sidorov',
      first_name: 'Сидор',
      last_name: 'Сидоров',
      password: 'password123',
      expires_at: null
    });
    createReq.flush(CREATED_USER, { status: 201, statusText: 'Created' });

    expect(component.users().length).toBe(4);
    expect(component.selectedUser()).toBeNull();
  });

  it('does not send anything when the form is invalid', () => {
    createPage();

    component.submit();

    expect(component.userForm.invalid).toBe(true);
  });

  it('deletes a user after confirmation', () => {
    createPage();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const deleteButtons = fixture.debugElement.queryAll(By.css('.users-table__action--danger'));
    deleteButtons[1].nativeElement.click();

    const deleteReq = http.expectOne(`${environment.apiUrl}/admin/users/2`);
    expect(deleteReq.request.method).toBe('DELETE');
    deleteReq.flush(USERS[1]);

    expect(component.users().length).toBe(2);
  });

  it('keeps the user when deletion is not confirmed', () => {
    createPage();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const deleteButtons = fixture.debugElement.queryAll(By.css('.users-table__action--danger'));
    deleteButtons[1].nativeElement.click();

    expect(component.users().length).toBe(3);
  });
});

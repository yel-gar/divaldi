import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, Routes } from '@angular/router';

import { Sidebar } from './sidebar.component';
import { USER_NAV_ITEMS, ADMIN_NAV_ITEMS } from './sidebar.config';
import { environment } from '../../../../environments/environment';

const HISTORY_URL = `${environment.apiUrl}/chats/`;

@Component({
  selector: 'app-sidebar-test-host',
  imports: [Sidebar],
  template: `<app-sidebar [navItems]="items" [role]="role" />`
})
class TestHost {
  items = USER_NAV_ITEMS;
  role: 'user' | 'admin' = 'user';
}

const TEST_ROUTES: Routes = [
  { path: 'create', component: TestHost },
  { path: 'chats', component: TestHost },
  { path: 'chats/:id', component: TestHost },
  { path: 'settings', component: TestHost },
  { path: 'profile', component: TestHost }
];

describe('Sidebar accessibility', () => {
  let fixture: ComponentFixture<TestHost>;
  let router: Router;
  let http: HttpTestingController;

  const getNavLinks = () => fixture.debugElement.queryAll(By.css('.navigation__item'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideRouter(TEST_ROUTES), provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(HISTORY_URL).flush([]);
  });

  afterEach(() => {
    http.verify();
  });

  it('exposes the navigation landmark with an accessible name', () => {
    const nav = fixture.debugElement.query(By.css('nav.navigation'));
    expect(nav.nativeElement.getAttribute('aria-label')).toBe('Основная навигация');
  });

  it('gives every nav link an accessible name from its label text', () => {
    const links = getNavLinks();
    expect(links.length).toBe(USER_NAV_ITEMS.length);
    links.forEach((link, i) => {
      expect(link.nativeElement.textContent).toContain(USER_NAV_ITEMS[i].label);
    });
  });

  it('marks the active route with aria-current="page"', async () => {
    await router.navigateByUrl('/settings');
    fixture.detectChanges();

    const current = getNavLinks().find((link) => link.nativeElement.getAttribute('aria-current'));
    expect(current?.nativeElement.textContent).toContain('Настройки');
    expect(current?.nativeElement.getAttribute('aria-current')).toBe('page');

    const active = getNavLinks().filter((link) => link.nativeElement.hasAttribute('aria-current'));
    expect(active.length).toBe(1);
  });

  it('does not mark any link active when on an unrelated route', async () => {
    await router.navigateByUrl('/create');
    fixture.detectChanges();

    expect(getNavLinks().filter((l) => l.nativeElement.hasAttribute('aria-current')).length).toBe(
      0
    );
  });

  it('leaves the non-interactive profile unmarked on /profile', async () => {
    await router.navigateByUrl('/profile');
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.profile a'))).toBeNull();
    expect(getNavLinks().filter((l) => l.nativeElement.hasAttribute('aria-current')).length).toBe(
      0
    );
  });

  it('renders admin nav items when the role is admin', () => {
    const adminFixture = TestBed.createComponent(TestHost);
    adminFixture.componentInstance.items = ADMIN_NAV_ITEMS;
    adminFixture.componentInstance.role = 'admin';
    adminFixture.detectChanges();

    const labels = adminFixture.debugElement
      .queryAll(By.css('.navigation__item'))
      .map((l) => l.nativeElement.textContent.trim());
    expect(labels).toEqual(ADMIN_NAV_ITEMS.map((item) => item.label));
  });
});

describe('Sidebar tab navigation', () => {
  let fixture: ComponentFixture<TestHost>;
  let router: Router;
  let http: HttpTestingController;

  const getNavLinks = () => fixture.debugElement.queryAll(By.css('.navigation__item'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideRouter(TEST_ROUTES), provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(HISTORY_URL).flush([]);
  });

  afterEach(() => {
    http.verify();
  });

  it('keeps every nav link in the natural tab order', async () => {
    await router.navigateByUrl('/settings');
    fixture.detectChanges();

    const links = getNavLinks();
    expect(links.length).toBe(USER_NAV_ITEMS.length);
    links.forEach((link) => {
      expect(link.nativeElement.getAttribute('tabindex')).toBeNull();
    });
  });

  it('renders the list without arrow-key widget semantics', () => {
    const list = fixture.debugElement.query(By.css('.navigation__list'));
    expect(list.nativeElement.getAttribute('tabindex')).toBeNull();
  });
});

describe('Sidebar history section', () => {
  let fixture: ComponentFixture<TestHost>;
  let router: Router;
  let http: HttpTestingController;

  const SESSIONS = [
    {
      session_id: 'bbbbbbbb-0000-4000-8000-000000000000',
      last_message: {
        id: 1,
        role: 'assistant',
        content: 'Latest',
        timestamp: '2025-06-01T12:00:00Z'
      },
      name: 'Расчёт КП'
    },
    {
      session_id: 'aaaaaaaa-0000-4000-8000-000000000000',
      last_message: { id: 2, role: 'user', content: 'Older', timestamp: '2025-05-26T12:00:00Z' },
      name: ''
    }
  ];

  const historyItems = () => fixture.debugElement.queryAll(By.css('.history__item'));
  const historySection = () => fixture.debugElement.query(By.css('.history'));

  const createWithSessions = (response: object | null, status = 200): void => {
    fixture = TestBed.createComponent(TestHost);
    router = TestBed.inject(Router);
    fixture.detectChanges();
    http
      .expectOne(HISTORY_URL)
      .flush(response, { status, statusText: status === 200 ? 'OK' : 'Server Error' });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideRouter(TEST_ROUTES), provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('renders the ИСТОРИЯ title with chats sorted by date descending', () => {
    createWithSessions(SESSIONS);

    expect(historySection().nativeElement.textContent).toContain('ИСТОРИЯ');
    const titles = historyItems().map((item) => item.nativeElement.textContent.trim());
    expect(titles).toEqual(['Расчёт КП', 'aaaaaaaa']);
  });

  it('shows the empty state when the user has no sessions', () => {
    createWithSessions([]);

    expect(historyItems().length).toBe(0);
    expect(historySection().nativeElement.textContent).toContain('История пока пуста');
  });

  it('shows an error state when the history request fails', () => {
    createWithSessions(null, 500);

    expect(historySection().nativeElement.textContent).toContain('Не удалось загрузить историю');
  });

  it('navigates to the chat when a history item is clicked', async () => {
    createWithSessions(SESSIONS);

    historyItems()[0].nativeElement.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(router.url).toBe('/chats/bbbbbbbb-0000-4000-8000-000000000000');
  });

  it('marks the history item of the open chat as current', async () => {
    createWithSessions(SESSIONS);

    await router.navigateByUrl('/chats/bbbbbbbb-0000-4000-8000-000000000000');
    fixture.detectChanges();

    const current = historyItems().find((item) => item.nativeElement.hasAttribute('aria-current'));
    expect(current?.nativeElement.textContent).toContain('Расчёт КП');
    expect(current?.nativeElement.getAttribute('aria-current')).toBe('true');
    expect(historyItems().length).toBe(2);
  });

  it('does not render the history section or request chats for the admin role', () => {
    fixture = TestBed.createComponent(TestHost);
    fixture.componentInstance.role = 'admin';
    fixture.detectChanges();

    expect(historySection()).toBeNull();
    http.expectNone(HISTORY_URL);
  });
});

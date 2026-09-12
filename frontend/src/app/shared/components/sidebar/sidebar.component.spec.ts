import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, Routes } from '@angular/router';

import { Sidebar } from './sidebar.component';
import { USER_NAV_ITEMS, ADMIN_NAV_ITEMS } from './sidebar.config';

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
  { path: 'settings', component: TestHost },
  { path: 'profile', component: TestHost }
];

describe('Sidebar accessibility', () => {
  let fixture: ComponentFixture<TestHost>;
  let router: Router;

  const getNavLinks = () => fixture.debugElement.queryAll(By.css('.navigation__item'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideRouter(TEST_ROUTES)]
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('exposes the navigation landmark with an accessible name', () => {
    const nav = fixture.debugElement.query(By.css('nav'));
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

  const getNavLinks = () => fixture.debugElement.queryAll(By.css('.navigation__item'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideRouter(TEST_ROUTES)]
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    router = TestBed.inject(Router);
    fixture.detectChanges();
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

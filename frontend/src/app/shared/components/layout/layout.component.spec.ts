import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, Routes } from '@angular/router';

import { Layout } from './layout.component';
import { USER_NAV_ITEMS } from '../sidebar/sidebar.config';
import { environment } from '../../../../environments/environment';

const HISTORY_URL = `${environment.apiUrl}/chats/`;
const AVATAR_URL = `${environment.apiUrl}/users/me/avatar`;

@Component({ selector: 'app-routed', template: '<p class="routed">Маршрут активирован</p>' })
class RoutedComponent {}

const TEST_ROUTES: Routes = [
  { path: '', component: RoutedComponent },
  { path: 'create', component: RoutedComponent }
];

@Component({
  selector: 'app-layout-test-host',
  imports: [Layout],
  template: `<app-layout [navItems]="items" role="user" />`
})
class TestHost {
  items = USER_NAV_ITEMS;
}

describe('Layout', () => {
  let fixture: ComponentFixture<TestHost>;
  let router: Router;
  let http: HttpTestingController;

  const createLayout = async (): Promise<void> => {
    fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === HISTORY_URL && r.method === 'GET')
      .flush({ items: [], total: 0, page: 0, items_per_page: 10 });
    fixture.detectChanges();
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
    http.match(AVATAR_URL).forEach((request) => request.flush({ avatar_url: null }));
    http.verify();
  });

  it('renders the sidebar with the configured navigation items', async () => {
    await createLayout();

    const labels = fixture.debugElement
      .queryAll(By.css('.navigation__item'))
      .map((link) => link.nativeElement.textContent.trim());

    expect(labels).toEqual(USER_NAV_ITEMS.map((item) => item.label));
  });

  it('hosts the router outlet inside a main landmark', async () => {
    await createLayout();

    const main = fixture.debugElement.query(By.css('main'));
    expect(main).not.toBeNull();
    expect(main.query(By.css('router-outlet'))).not.toBeNull();
  });

  it('activates the routed component in the outlet', async () => {
    await createLayout();
    expect(fixture.debugElement.query(By.css('.routed'))).toBeNull();

    await router.navigateByUrl('/create');
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('main .routed')).nativeElement.textContent).toContain(
      'Маршрут активирован'
    );
  });
});

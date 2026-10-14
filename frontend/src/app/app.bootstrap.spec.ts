import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { App } from './app.component';
import { appConfig } from './app.config';
import { routes } from './app.routes';
import { SettingsPage } from './pages/settings-page/settings-page.component';

describe('App bootstrap pieces', () => {
  it('exposes the routes table and the providers list', () => {
    expect(routes.length).toBeGreaterThan(0);
    expect(appConfig.providers.length).toBeGreaterThan(0);
  });

  it('renders the placeholder settings page', () => {
    const fixture = TestBed.configureTestingModule({ imports: [SettingsPage] }).createComponent(
      SettingsPage
    );
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('*')).length).toBeGreaterThan(0);
  });

  it('creates the root component', () => {
    const fixture = TestBed.configureTestingModule({ imports: [App] }).createComponent(App);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeInstanceOf(App);
  });
});

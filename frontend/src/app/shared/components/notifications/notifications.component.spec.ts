import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';

import { NotificationsComponent } from './notifications.component';
import { NotificationService } from '../../../core/services/notification.service';

const NOTIFICATION_DURATION_MS = 5000;
const LEAVE_ANIMATION_MS = 220;

describe('NotificationsComponent', () => {
  let fixture: ComponentFixture<NotificationsComponent>;
  let component: NotificationsComponent;
  let service: NotificationService;

  const notification = () => fixture.debugElement.query(By.css('app-notification'));
  const title = () => fixture.debugElement.query(By.css('.notification__title'));
  const closeButton = () => fixture.debugElement.query(By.css('.notification__close'));
  const host = () => notification().nativeElement as HTMLElement;

  const refresh = (): void => fixture.detectChanges();

  /** Only setTimeout is faked so the Angular scheduler keeps using real timers. */
  const useFakeTimers = (): void => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NotificationsComponent] }).compileComponents();

    service = TestBed.inject(NotificationService);
    fixture = TestBed.createComponent(NotificationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an empty list when there are no notifications', () => {
    expect(fixture.debugElement.query(By.css('ul.notifications'))).not.toBeNull();
    expect(notification()).toBeNull();
    expect(component.displayed()).toBeNull();
  });

  it('renders the message and the type of the notification pushed by the service', () => {
    service.error('Не удалось создать заявку: Ошибка сервера');
    refresh();

    expect(title().nativeElement.textContent).toBe('Не удалось создать заявку: Ошибка сервера');
    expect(host().getAttribute('data-type')).toBe('error');
    expect(host().getAttribute('role')).toBe('status');
    expect(host().getAttribute('aria-live')).toBe('polite');
  });

  it('renders a success notification with its own type', () => {
    service.success('Новый чат создан');
    refresh();

    expect(title().nativeElement.textContent).toBe('Новый чат создан');
    expect(host().getAttribute('data-type')).toBe('success');
    expect(host().classList).not.toContain('notification--leaving');
  });

  it('lets the replaced notification finish its leave animation before showing the new one', () => {
    useFakeTimers();
    service.info('Первое');
    refresh();
    expect(title().nativeElement.textContent).toBe('Первое');

    service.info('Второе');
    refresh();

    expect(title().nativeElement.textContent).toBe('Первое');
    expect(host().classList).toContain('notification--leaving');
    expect(component.leaving()).toHaveLength(1);

    vi.advanceTimersByTime(LEAVE_ANIMATION_MS);
    refresh();

    expect(component.leaving()).toHaveLength(0);
    expect(title().nativeElement.textContent).toBe('Второе');
    expect(fixture.debugElement.queryAll(By.css('app-notification')).length).toBe(1);
  });

  it('removes the notification from the service when the close button is clicked', () => {
    useFakeTimers();
    service.error('Заполните логин и пароль');
    refresh();

    closeButton().nativeElement.click();
    refresh();

    expect(service.notifications()).toHaveLength(0);
    expect(component.isLeaving(component.displayed()?.id ?? '')).toBe(true);
  });

  it('hides the notification entirely once the leave animation ends', () => {
    useFakeTimers();
    service.error('Заполните логин и пароль');
    refresh();

    closeButton().nativeElement.click();
    vi.advanceTimersByTime(LEAVE_ANIMATION_MS);
    refresh();

    expect(component.displayed()).toBeNull();
    expect(notification()).toBeNull();
  });

  it('hides the notification automatically after five seconds', () => {
    useFakeTimers();
    service.info('Файл загружен');
    refresh();

    vi.advanceTimersByTime(NOTIFICATION_DURATION_MS - 1);
    refresh();
    expect(title().nativeElement.textContent).toBe('Файл загружен');
    expect(service.notifications()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    refresh();
    expect(service.notifications()).toHaveLength(0);

    vi.advanceTimersByTime(LEAVE_ANIMATION_MS);
    refresh();

    expect(notification()).toBeNull();
  });

  it('removes the dismissed notification from the list when a new one is pushed behind it', () => {
    useFakeTimers();
    service.info('Уходит');
    refresh();

    closeButton().nativeElement.click();
    service.success('Новый чат создан');
    vi.advanceTimersByTime(LEAVE_ANIMATION_MS);
    refresh();

    expect(title().nativeElement.textContent).toBe('Новый чат создан');
    expect(host().classList).not.toContain('notification--leaving');
  });
});

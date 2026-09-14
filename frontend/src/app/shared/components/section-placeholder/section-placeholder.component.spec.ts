import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SectionPlaceholder } from './section-placeholder.component';

describe('SectionPlaceholder', () => {
  const render = (title: string, subtitle = ''): ComponentFixture<SectionPlaceholder> => {
    const fixture = TestBed.createComponent(SectionPlaceholder);
    fixture.componentRef.setInput('title', title);
    fixture.componentRef.setInput('subtitle', subtitle);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SectionPlaceholder] }).compileComponents();
  });

  it('renders the title and the development label', () => {
    const element = render('Журнал действий').nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Журнал действий');
    expect(element.textContent).toContain('Раздел в разработке');
  });

  it('renders the subtitle only when provided', () => {
    const withSubtitle = render('Настройки', 'Параметры работы системы');
    expect(withSubtitle.nativeElement.querySelector('.h4')?.textContent).toContain(
      'Параметры работы системы'
    );

    const withoutSubtitle = render('О системе');
    expect(withoutSubtitle.nativeElement.querySelector('.h4')).toBeNull();
  });
});

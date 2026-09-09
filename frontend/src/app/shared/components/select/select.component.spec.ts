import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { noop } from 'rxjs';
import { By } from '@angular/platform-browser';

import { Select, SelectOption } from './select.component';

const OPTIONS: SelectOption[] = [
  { value: 'internal', label: 'Внутренний проект' },
  { value: 'client', label: 'Клиентский проект' },
  { value: 'research', label: 'Исследование и аналитика' },
  { value: 'support', label: 'Поддержка и развитие' },
  { value: 'other', label: 'Другое' }
];

@Component({
  selector: 'app-test-host',
  imports: [Select, ReactiveFormsModule],
  template: `
    <div class="outside"></div>
    <app-select [formControl]="control" [options]="options" [placeholder]="placeholder" />
  `
})
class TestHost {
  options = OPTIONS;
  readonly placeholder = 'Выберите тип проекта';
  readonly control = new FormControl<string | null>(null, { nonNullable: false });
}

@Component({
  selector: 'app-test-host-disabled',
  imports: [Select],
  template: `<app-select [options]="options" [disabled]="disabled()" />`
})
class DisabledTestHost {
  readonly options = OPTIONS;
  readonly disabled = signal(false);
}

@Component({
  selector: 'app-test-host-label',
  imports: [Select],
  template: `<app-select [options]="options" label="Тип проекта" />`
})
class LabelTestHost {
  readonly options = OPTIONS;
}

@Component({
  selector: 'app-test-host-error',
  imports: [Select, ReactiveFormsModule],
  template: `<app-select [formControl]="control" [options]="options" />`
})
class ErrorTestHost {
  readonly options = OPTIONS;
  readonly control = new FormControl<string | null>(null, Validators.required);
}

describe('Select', () => {
  let fixture: ComponentFixture<TestHost>;
  let host: TestHost;
  let selectDebug: ReturnType<typeof fixture.debugElement.query>;
  let select: Select;

  const getTrigger = () => selectDebug.query(By.css('button[role="combobox"]'));
  const getListbox = () => selectDebug.query(By.css('ul[role="listbox"]'));
  const getOptions = () => selectDebug.queryAll(By.css('li[role="option"]'));

  async function openListboxFor(fx: ComponentFixture<unknown>) {
    fx.debugElement
      .query(By.directive(Select))
      .query(By.css('button[role="combobox"]'))
      .nativeElement.click();
    await fx.whenStable();
    fx.detectChanges();
  }

  function openListbox() {
    return openListboxFor(fixture);
  }

  function keydownOnTrigger(key: string) {
    getTrigger().triggerEventHandler('keydown', {
      key,
      preventDefault: noop,
      stopPropagation: noop
    } as KeyboardEvent);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    selectDebug = fixture.debugElement.query(By.directive(Select));
    select = selectDebug.componentInstance as Select;
  });

  describe('ControlValueAccessor', () => {
    it('should register itself with NG_VALUE_ACCESSOR and work with a form control', () => {
      expect(select).toBeTruthy();

      host.control.setValue('client');
      fixture.detectChanges();

      expect(select.value()).toBe('client');
      expect(select.selectedLabel()).toBe('Клиентский проект');
    });

    it('should display the placeholder when the value is null', () => {
      const valueEl = getTrigger().query(By.css('.select__value'))!.nativeElement as HTMLElement;
      expect(valueEl.textContent!.trim()).toBe('Выберите тип проекта');
      expect(select.value()).toBeNull();
    });

    it('should propagate option selection to the form control', async () => {
      await openListbox();
      getOptions()[2].nativeElement.click();
      fixture.detectChanges();

      expect(host.control.value).toBe('research');
      expect(select.isOpen()).toBe(false);
    });

    it('should mark the control touched when the dropdown closes', async () => {
      expect(host.control.touched).toBe(false);

      await openListbox();
      fixture.debugElement.query(By.css('.outside')).nativeElement.click();
      fixture.detectChanges();

      expect(select.isOpen()).toBe(false);
      expect(host.control.touched).toBe(true);
    });

    it('should respect a disabled form control and ignore selection attempts', async () => {
      host.control.disable();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(select.isDisabled()).toBe(true);
      expect(getTrigger().nativeElement.getAttribute('aria-disabled')).toBe('true');

      await openListbox();
      expect(select.isOpen()).toBe(false);
      expect(getListbox()).toBeNull();
    });

    it('should reflect [disabled] input even with an enabled control', async () => {
      const disabledFixture = TestBed.createComponent(DisabledTestHost);
      disabledFixture.detectChanges();
      await disabledFixture.whenStable();
      const disabledSelect = disabledFixture.debugElement.query(By.directive(Select))
        .componentInstance as Select;

      expect(disabledSelect.isDisabled()).toBe(false);

      disabledFixture.componentInstance.disabled.set(true);
      disabledFixture.detectChanges();
      await disabledFixture.whenStable();

      expect(disabledSelect.isDisabled()).toBe(true);
    });
  });

  describe('outside click', () => {
    it('should close the dropdown when clicking outside the component', async () => {
      await openListbox();
      expect(select.isOpen()).toBe(true);

      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await fixture.whenStable();

      expect(select.isOpen()).toBe(false);
    });

    it('should not close when clicking inside the component', async () => {
      await openListbox();
      expect(select.isOpen()).toBe(true);

      selectDebug.nativeElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await fixture.whenStable();

      expect(select.isOpen()).toBe(true);
    });
  });

  describe('keyboard navigation', () => {
    it('should open the listbox on Enter and Space', async () => {
      keydownOnTrigger('Enter');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(select.isOpen()).toBe(true);

      keydownOnTrigger('Escape');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(select.isOpen()).toBe(false);

      keydownOnTrigger(' ');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(select.isOpen()).toBe(true);
    });

    it('should close the listbox on Escape', async () => {
      await openListbox();

      keydownOnTrigger('Escape');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(select.isOpen()).toBe(false);
    });

    it('should select the highlighted option with Enter when open', async () => {
      await openListbox();

      keydownOnTrigger('ArrowDown');
      keydownOnTrigger('Enter');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(host.control.value).toBe('client');
      expect(select.isOpen()).toBe(false);
    });

    it('should move the highlight with ArrowDown/ArrowUp and wrap around', async () => {
      await openListbox();
      expect(select.highlightedIndex()).toBe(0);

      keydownOnTrigger('ArrowDown');
      expect(select.highlightedIndex()).toBe(1);

      keydownOnTrigger('ArrowUp');
      keydownOnTrigger('ArrowUp');
      expect(select.highlightedIndex()).toBe(OPTIONS.length - 1);

      keydownOnTrigger('ArrowDown');
      expect(select.highlightedIndex()).toBe(0);
    });

    it('should close the listbox on Tab and mark the control touched', async () => {
      await openListbox();
      expect(select.isOpen()).toBe(true);
      expect(host.control.touched).toBe(false);

      keydownOnTrigger('Tab');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(select.isOpen()).toBe(false);
      expect(host.control.touched).toBe(true);
    });

    it('should jump to the first/last option with Home/End', async () => {
      await openListbox();

      keydownOnTrigger('End');
      expect(select.highlightedIndex()).toBe(OPTIONS.length - 1);

      keydownOnTrigger('Home');
      expect(select.highlightedIndex()).toBe(0);
    });

    it('should highlight the selected option when opened', async () => {
      host.control.setValue('research');
      fixture.detectChanges();
      await fixture.whenStable();

      await openListbox();
      expect(select.highlightedIndex()).toBe(2);
    });
  });

  describe('aria attributes', () => {
    it('should expose combobox semantics with aria-expanded state', async () => {
      const trigger = getTrigger().nativeElement as HTMLElement;
      expect(trigger.getAttribute('role')).toBe('combobox');
      expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      await openListbox();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(getListbox()).not.toBeNull();
    });

    it('should set aria-selected on options', async () => {
      host.control.setValue('client');
      fixture.detectChanges();
      await fixture.whenStable();

      await openListbox();
      const options = getOptions();
      expect(options.length).toBe(OPTIONS.length);
      expect(options[1].nativeElement.getAttribute('aria-selected')).toBe('true');
      expect(options[0].nativeElement.getAttribute('aria-selected')).toBe('false');
    });

    it('should forward aria-label to the trigger', async () => {
      const labelFixture = TestBed.createComponent(LabelTestHost);
      labelFixture.detectChanges();
      await labelFixture.whenStable();

      const trigger = labelFixture.debugElement
        .query(By.directive(Select))
        .query(By.css('button[role="combobox"]')).nativeElement as HTMLElement;

      expect(trigger.getAttribute('aria-label')).toBe('Тип проекта');
    });
  });

  describe('empty state', () => {
    it('should render the empty row when there are no options', async () => {
      const emptyFixture = TestBed.createComponent(TestHost);
      emptyFixture.componentInstance.options = [];
      emptyFixture.detectChanges();
      await emptyFixture.whenStable();

      const emptySelect = emptyFixture.debugElement.query(By.directive(Select));

      await openListboxFor(emptyFixture);

      const empty = emptySelect.query(By.css('.select__empty'));
      expect(empty).not.toBeNull();
      expect(empty.nativeElement.textContent.trim()).toBe('Ничего не найдено');
      expect(emptySelect.queryAll(By.css('li[role="option"]'))).toHaveLength(0);
    });
  });

  describe('error state', () => {
    it('should show the error state when a required control is touched and empty', async () => {
      const errorFixture = TestBed.createComponent(ErrorTestHost);
      errorFixture.detectChanges();
      await errorFixture.whenStable();
      const errorSelect = errorFixture.debugElement.query(By.directive(Select))
        .componentInstance as Select;
      const errorSelectDebug = errorFixture.debugElement.query(By.directive(Select));

      expect(errorSelect.showError()).toBe(false);

      await openListboxFor(errorFixture);

      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      errorFixture.detectChanges();
      await errorFixture.whenStable();

      expect(errorSelect.showError()).toBe(true);
      expect(
        errorSelectDebug.query(By.css('.select')).nativeElement.classList.contains('select--error')
      ).toBe(true);
      expect(
        errorSelectDebug
          .query(By.css('button[role="combobox"]'))
          .nativeElement.getAttribute('aria-invalid')
      ).toBe('true');
    });
  });

  describe('dropup positioning', () => {
    function mockTriggerRect(top: number, bottom: number) {
      vi.spyOn(getTrigger().nativeElement, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, top, 200, bottom - top)
      );
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should flip above the trigger when there is not enough space below', async () => {
      mockTriggerRect(700, 740);

      await openListbox();

      expect(select.dropUp()).toBe(true);
      expect(
        selectDebug.query(By.css('.select')).nativeElement.classList.contains('select--dropup')
      ).toBe(true);
    });

    it('should open downward when there is enough space below', async () => {
      mockTriggerRect(100, 140);

      await openListbox();

      expect(select.dropUp()).toBe(false);
    });

    it('should not flip when neither side has enough room', async () => {
      mockTriggerRect(100, 766);

      await openListbox();

      expect(select.dropUp()).toBe(false);
    });

    it('should re-evaluate the flip direction while open on scroll', async () => {
      mockTriggerRect(700, 740);
      await openListbox();
      expect(select.dropUp()).toBe(true);

      mockTriggerRect(100, 140);
      document.dispatchEvent(new Event('scroll'));
      select.flushScrollFrame();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(select.dropUp()).toBe(false);
    });

    it('should batch scroll handling to at most one measurement per frame', async () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
      mockTriggerRect(700, 740);
      await openListbox();
      rafSpy.mockClear();

      for (let i = 0; i < 10; i++) {
        document.dispatchEvent(new Event('scroll'));
      }

      expect(rafSpy).toHaveBeenCalledTimes(1);

      vi.mocked(window.requestAnimationFrame).mockRestore();
    });
  });
});

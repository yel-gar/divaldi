import { TestBed } from '@angular/core/testing';
import { ChatMessageComponent } from './chat-message.component';
import { ChatMessage } from './chat-message.model';

describe('ChatMessageComponent', () => {
  const render = (text: string, attachments?: ChatMessage['attachments']): HTMLElement => {
    const fixture = TestBed.createComponent(ChatMessageComponent);
    fixture.componentRef.setInput('message', {
      id: 1,
      direction: 'incoming',
      text,
      time: '12:00',
      attachments
    } as ChatMessage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('renders message text as markdown', () => {
    const element = render('**жирный** текст');
    expect(element.querySelector('.message__text')?.innerHTML).toContain('<strong>жирный</strong>');
  });

  it('does not render raw markdown syntax', () => {
    const element = render('**жирный** текст');
    expect(element.querySelector('.message__text')?.textContent).not.toContain('**');
  });

  it('renders a server attachment chip with enabled preview and download', () => {
    const element = render('Коммерческое предложение готово', [
      { name: 'kp.xlsx', attachmentId: 5 }
    ]);

    expect(element.querySelector('.message__attachment-name')?.textContent).toContain('kp.xlsx');
    expect(
      element.querySelector('button[aria-label="Предпросмотр"]')?.hasAttribute('disabled')
    ).toBe(false);
    expect(element.querySelector('button[aria-label="Скачать"]')?.hasAttribute('disabled')).toBe(
      false
    );
  });

  it('emits the attachment on download click', () => {
    const fixture = TestBed.createComponent(ChatMessageComponent);
    const emitted: unknown[] = [];
    fixture.componentRef.setInput('message', {
      id: 1,
      direction: 'incoming',
      text: 'КП',
      time: '12:00',
      attachments: [{ name: 'kp.xlsx', attachmentId: 5 }]
    } as ChatMessage);
    fixture.componentInstance.download.subscribe((attachment) => emitted.push(attachment));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector('button[aria-label="Скачать"]')
      ?.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(emitted).toEqual([{ name: 'kp.xlsx', attachmentId: 5 }]);
  });

  it('disables attachment actions without file or attachment id', () => {
    const element = render('Файлы', [{ name: 'unknown.pdf' }]);

    expect(
      element.querySelector('button[aria-label="Предпросмотр"]')?.hasAttribute('disabled')
    ).toBe(true);
    expect(element.querySelector('button[aria-label="Скачать"]')?.hasAttribute('disabled')).toBe(
      true
    );
  });
});

import { TestBed } from '@angular/core/testing';
import { ChatMessageComponent } from './chat-message.component';
import { ChatMessage } from './chat-message.model';

describe('ChatMessageComponent', () => {
  const render = (text: string): HTMLElement => {
    const fixture = TestBed.createComponent(ChatMessageComponent);
    fixture.componentRef.setInput('message', {
      id: 1,
      direction: 'incoming',
      text,
      time: '12:00'
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
});

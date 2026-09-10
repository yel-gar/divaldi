import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideBot, LucideCheck, LucideCheckCheck, LucideClock } from '@lucide/angular';
import { ChatMessage } from './chat-message.model';

@Component({
  selector: 'app-chat-message',
  imports: [LucideBot, LucideCheck, LucideCheckCheck, LucideClock],
  standalone: true,
  templateUrl: './chat-message.html',
  styleUrl: './chat-message.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.message--incoming]': 'isIncoming()',
    '[class.message--outgoing]': '!isIncoming()'
  }
})
export class ChatMessageComponent {
  readonly message = input.required<ChatMessage>();

  readonly isIncoming = computed(() => this.message().direction === 'incoming');
}

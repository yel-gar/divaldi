import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  LucideBot,
  LucideCheck,
  LucideCheckCheck,
  LucideClock,
  LucideDynamicIcon,
  LucideEye
} from '@lucide/angular';
import type { LucideIconData } from '@lucide/angular';
import { fileTypeStyleFor } from '../../shared/components/drag-n-drop/file-type-icons';
import { formatBytes, getFileExtension } from '../../shared/utils/upload-format';
import { ChatMessage, ChatMessageAttachment } from './chat-message.model';

@Component({
  selector: 'app-chat-message',
  imports: [LucideBot, LucideCheck, LucideCheckCheck, LucideClock, LucideDynamicIcon, LucideEye],
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

  readonly preview = output<ChatMessageAttachment>();

  readonly isIncoming = computed(() => this.message().direction === 'incoming');

  readonly hasAttachments = computed(() => (this.message().attachments?.length ?? 0) > 0);

  iconFor(name: string): LucideIconData {
    return fileTypeStyleFor(getFileExtension(name)).icon;
  }

  colorFor(name: string): string {
    return fileTypeStyleFor(getFileExtension(name)).color;
  }

  formatBytes(bytes: number): string {
    return formatBytes(bytes);
  }
}

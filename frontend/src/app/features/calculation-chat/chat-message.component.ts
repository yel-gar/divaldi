import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  LucideBot,
  LucideCheck,
  LucideCheckCheck,
  LucideClock,
  LucideCopy,
  LucideDynamicIcon,
  LucideEye,
  LucideRefreshCw
} from '@lucide/angular';
import type { LucideIconData } from '@lucide/angular';
import { fileTypeStyleFor } from '../../shared/components/drag-n-drop/file-type-icons';
import { formatBytes, getFileExtension } from '../../shared/utils/upload-format';
import { ChatMessage, ChatMessageAttachment } from './chat-message.model';

@Component({
  selector: 'app-chat-message',
  imports: [
    LucideBot,
    LucideCheck,
    LucideCheckCheck,
    LucideClock,
    LucideCopy,
    LucideDynamicIcon,
    LucideEye,
    LucideRefreshCw
  ],
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
  readonly replyDisabled = input(false, {
    transform: (value: boolean | string) => value === true || value === ''
  });

  readonly preview = output<ChatMessageAttachment>();
  readonly reply = output<void>();

  readonly copied = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly isIncoming = computed(() => this.message().direction === 'incoming');

  readonly hasAttachments = computed(() => (this.message().attachments?.length ?? 0) > 0);

  copyText(): void {
    navigator.clipboard.writeText(this.message().text);
    this.copied.set(true);
    if (this.copiedTimer !== null) {
      clearTimeout(this.copiedTimer);
    }
    this.copiedTimer = setTimeout(() => this.copied.set(false), 1500);
  }

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

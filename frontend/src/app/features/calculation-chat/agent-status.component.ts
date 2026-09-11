import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import { LucideBot, LucideSparkles } from '@lucide/angular';

const THINKING_PHRASES = [
  'Анализирую запрос…',
  'Сверяюсь с методикой расчёта…',
  'Считаю параметры…'
];

const PHRASE_INTERVAL_MS = 1600;

@Component({
  selector: 'app-agent-status',
  imports: [LucideBot, LucideSparkles],
  standalone: true,
  templateUrl: './agent-status.html',
  styleUrl: './agent-status.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.agent-status--thinking]': 'status() === "thinking"'
  }
})
export class AgentStatusComponent {
  readonly status = input.required<'thinking' | 'typing'>();
  readonly phrase = signal(THINKING_PHRASES[0]);
  private phraseIndex = 0;

  constructor() {
    effect((onCleanup) => {
      if (this.status() !== 'thinking') {
        return;
      }

      const timer = setInterval(() => {
        this.phraseIndex = (this.phraseIndex + 1) % THINKING_PHRASES.length;
        this.phrase.set(THINKING_PHRASES[this.phraseIndex]);
      }, PHRASE_INTERVAL_MS);

      onCleanup(() => clearInterval(timer));
    });
  }
}

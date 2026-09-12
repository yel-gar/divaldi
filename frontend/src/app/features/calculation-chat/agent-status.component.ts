import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideBot } from '@lucide/angular';

@Component({
  selector: 'app-agent-status',
  imports: [LucideBot],
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
}

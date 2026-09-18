import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LucideBot } from '@lucide/angular';

@Component({
  selector: 'app-agent-status',
  imports: [LucideBot],
  standalone: true,
  templateUrl: './agent-status.component.html',
  styleUrl: './agent-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'agent-status--thinking'
  }
})
export class AgentStatusComponent {}

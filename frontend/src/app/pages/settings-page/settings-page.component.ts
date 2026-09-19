import { Component } from '@angular/core';
import { SectionPlaceholder } from '../../shared/components/section-placeholder/section-placeholder.component';

@Component({
  selector: 'app-settings-page',
  imports: [SectionPlaceholder],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss'
})
export class SettingsPage {}

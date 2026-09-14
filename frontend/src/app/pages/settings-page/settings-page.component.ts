import { Component } from '@angular/core';
import { SectionPlaceholder } from '../../shared/components/section-placeholder/section-placeholder.component';

@Component({
  selector: 'app-settings-page',
  imports: [SectionPlaceholder],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss'
})
export class SettingsPage {}

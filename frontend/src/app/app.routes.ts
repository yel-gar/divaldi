import { Routes } from '@angular/router';
import { OrderCreateComponent } from './features/order-create/order-create.component';
import { CalculationChatComponent } from './features/calculation-chat/calculation-chat.component';
import { Layout } from './shared/components/layout/layout.component';
import { ADMIN_NAV_ITEMS, USER_NAV_ITEMS } from './shared/components/sidebar/sidebar.config';
import { HistoryPage } from './pages/history-page/history-page.component';
import { SettingsPage } from './pages/settings-page/settings-page.component';
import { ProfilePage } from './pages/profile-page/profile-page';

export const routes: Routes = [
  {
    path: '',
    component: Layout,
    data: { navItems: USER_NAV_ITEMS, role: 'user' },
    children: [
      { path: '', redirectTo: '/create', pathMatch: 'full' },
      { path: 'chats', component: HistoryPage },
      { path: 'create', component: OrderCreateComponent },
      { path: 'settings', component: SettingsPage },
      { path: 'chats/:id', component: CalculationChatComponent },
      { path: 'profile', component: ProfilePage },
      { path: '**', redirectTo: '/create' }
    ]
  },
  {
    path: 'admin',
    component: Layout,
    data: { navItems: ADMIN_NAV_ITEMS, role: 'admin' }
  }
];

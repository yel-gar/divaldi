import { Routes } from '@angular/router';
import { OrderCreateComponent } from './features/order-create/order-create.component';
import { CalculationChatComponent } from './features/calculation-chat/calculation-chat.component';
import { Layout } from './shared/components/layout/layout.component';
import { ADMIN_NAV_ITEMS, USER_NAV_ITEMS } from './shared/components/sidebar/sidebar.config';
import { HistoryPage } from './pages/history-page/history-page.component';
import { SettingsPage } from './pages/settings-page/settings-page.component';
import { ProfilePage } from './pages/profile-page/profile-page';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { adminGuard, authGuard, publicGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginPageComponent,
    canActivate: [publicGuard]
  },
  {
    path: '',
    component: Layout,
    canActivate: [authGuard],
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
    canActivate: [authGuard, adminGuard],
    data: { navItems: ADMIN_NAV_ITEMS, role: 'admin' }
  }
];

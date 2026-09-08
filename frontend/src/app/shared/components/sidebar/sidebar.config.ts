import {
  LucideHistory,
  LucideSettings,
  LucideUser,
  LucideInfo,
  type LucideIcon
} from '@lucide/angular';

export type Role = 'user' | 'admin';

export interface NavItem {
  label: string;
  icon: LucideIcon;
  route: string;
}

export const USER_NAV_ITEMS: NavItem[] = [
  { label: 'История заявок', icon: LucideHistory, route: '/chats' },
  { label: 'Настройки', icon: LucideSettings, route: '/settings' }
];

const ADMIN_PREFIX = '/admin/';

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { label: 'Пользователи', icon: LucideUser, route: `${ADMIN_PREFIX}users` },
  { label: 'Журнал действий', icon: LucideHistory, route: `${ADMIN_PREFIX}actions` },
  { label: 'Настройки', icon: LucideSettings, route: `${ADMIN_PREFIX}settings` },
  { label: 'О системе', icon: LucideInfo, route: `${ADMIN_PREFIX}system` }
];

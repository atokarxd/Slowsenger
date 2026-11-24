import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DEFAULT_AVATAR } from '../../core/default-avatar';
import { AppUserSummary } from '../../core/supabase/supabase.types';

/** "Anna, Péter, Eszter": who else is in a group, by first name. */
export function memberNames(members: AppUserSummary[]): string {
  return members.map((m) => m.name.split(' ')[0]).join(', ');
}

/** A colour of its own for each member's name in a group chat, readable on the dark background. */
const NAME_COLORS = ['#7cb8ff', '#f39a85', '#5fd0a5', '#c8a2ff', '#f5c45e', '#6fd8dd', '#ff9ec7'];
export function memberColor(userId: string | null): string {
  let hash = 0;
  for (const char of userId ?? '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}

/**
 * A group's picture: two of its members, one behind the other, in the space of one avatar. Its size is
 * the host's (set width and height on it); --ring is the colour behind it, which parts the two faces.
 */
@Component({
  selector: 'app-group-avatar',
  template: `
    @for (member of faces(); track member.id; let i = $index) {
      <img [src]="member.avatarUrl || defaultAvatar" alt="" [class]="faces().length === 1 ? 'face only' : 'face face-' + i" draggable="false">
    }
  `,
  styleUrl: './group-avatar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()' },
})
export class GroupAvatar {
  readonly members = input.required<AppUserSummary[]>();
  readonly defaultAvatar = DEFAULT_AVATAR;

  readonly faces = computed(() => this.members().slice(0, 2));
  readonly label = computed(() => `Group: ${memberNames(this.members())}`);
}

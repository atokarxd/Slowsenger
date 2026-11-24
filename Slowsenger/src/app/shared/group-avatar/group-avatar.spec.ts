import { TestBed } from '@angular/core/testing';

import { makeUser } from '../../core/commitments/commitment.testing';
import { GroupAvatar, memberColor, memberNames } from './group-avatar';

describe('GroupAvatar', () => {
  const show = async (count: number) => {
    TestBed.configureTestingModule({ imports: [GroupAvatar] });
    const fixture = TestBed.createComponent(GroupAvatar);
    fixture.componentRef.setInput('members', ['Anna Kovács', 'Péter Nagy', 'Eszter Horváth'].slice(0, count).map((name, i) => ({ ...makeUser(`u${i}`, name), avatarUrl: `a${i}.svg` })));
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('shows two of the members, one behind the other, and names them all', async () => {
    const host = await show(3);
    expect([...host.querySelectorAll('img')].map((img) => [img.getAttribute('src'), img.className])).toEqual([
      ['a0.svg', 'face face-0'], ['a1.svg', 'face face-1'],
    ]);
    expect(host.getAttribute('aria-label')).toBe('Group: Anna, Péter, Eszter');
  });

  it('fills the space with a single member', async () => {
    const host = await show(1);
    expect(host.querySelector('img')?.className).toBe('face only');
  });
});

describe('member names and colours', () => {
  it('lists first names', () => {
    expect(memberNames([makeUser('a', 'Anna Kovács'), makeUser('b', 'Péter Nagy')])).toBe('Anna, Péter');
  });

  it('gives a member the same colour every time', () => {
    expect(memberColor('user-1')).toBe(memberColor('user-1'));
    expect(memberColor('user-1')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

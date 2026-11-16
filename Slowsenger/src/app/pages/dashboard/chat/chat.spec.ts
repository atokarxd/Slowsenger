import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Chat } from './chat';

describe('Chat', () => {
  let component: Chat;
  let fixture: ComponentFixture<Chat>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Chat],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Chat);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the today button only inside a conversation', async () => {
    const todayButton = () => fixture.nativeElement.querySelector('app-today-button');
    expect(todayButton()).toBeNull();

    fixture.componentRef.setInput('selectedUser', { id: 'u2', name: 'Anna', username: 'anna', avatarUrl: '' });
    await fixture.whenStable();
    expect(todayButton()).not.toBeNull();

    fixture.componentRef.setInput('selectedUser', null);
    await fixture.whenStable();
    expect(todayButton()).toBeNull();
  });

  it('closes the today panel when another user is picked, but not for the same user again', async () => {
    const anna = { id: 'u2', name: 'Anna', username: 'anna', avatarUrl: '' };
    const todayButton = () => fixture.nativeElement.querySelector('app-today-button') as HTMLElement;
    fixture.componentRef.setInput('selectedUser', anna);
    await fixture.whenStable();

    todayButton().querySelector('button')!.click();
    await fixture.whenStable();
    expect(component.isTodayOpen()).toBe(true);
    expect(todayButton().classList).toContain('is-expanded'); // faded out while the panel is open

    fixture.componentRef.setInput('selectedUser', { ...anna });
    await fixture.whenStable();
    expect(component.isTodayOpen()).toBe(true);

    fixture.componentRef.setInput('selectedUser', { id: 'u3', name: 'Péter', username: 'peter', avatarUrl: '' });
    await fixture.whenStable();
    expect(component.isTodayOpen()).toBe(false);
    expect(todayButton().classList).not.toContain('is-expanded');
  });
});

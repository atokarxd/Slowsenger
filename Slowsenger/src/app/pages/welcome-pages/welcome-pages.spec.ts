import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WelcomePages } from './welcome-pages';

describe('WelcomePages', () => {
  let component: WelcomePages;
  let fixture: ComponentFixture<WelcomePages>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WelcomePages],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomePages);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Regist } from './regist';

describe('Regist', () => {
  let component: Regist;
  let fixture: ComponentFixture<Regist>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Regist],
    }).compileComponents();

    fixture = TestBed.createComponent(Regist);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

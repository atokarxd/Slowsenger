const fs = require('fs');

const path = 'Slowsenger/src/app/pages/dashboard/user-list/user-list.ts';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('activeSwipedId')) {
  // Insert properties
  code = code.replace(/pinnedUsers: ChatListItem\[\] = \[\];/, 
    `pinnedUsers: ChatListItem[] = [];
  
  // Swipe logic properties
  activeSwipedId: string | number | null = null;
  private startX = 0;
  currentSwipeX = 0;
  swipingId: string | number | null = null;`);

  // Insert methods
  code = code.replace(/toggleSearch\(\) \{/, 
  `// Swipe Handlers
  onTouchStart(event: TouchEvent | MouseEvent, id: string | number) {
    this.startX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    this.swipingId = id;
    this.currentSwipeX = 0;
  }

  onTouchMove(event: TouchEvent | MouseEvent) {
    if (!this.startX || this.swipingId == null) return;
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const deltaX = clientX - this.startX;
    
    // Only allow left swipe (negative delta) up to max -120px (for two buttons)
    if (deltaX < 0) {
      this.currentSwipeX = Math.max(deltaX, -120);
    } else {
      this.currentSwipeX = 0;
    }
  }

  onTouchEnd(id: string | number) {
    if (this.swipingId !== id) return;
    
    if (this.currentSwipeX < -50) {
      this.activeSwipedId = id;
    } else {
      this.activeSwipedId = null;
    }
    this.swipingId = null;
    this.startX = 0;
    this.currentSwipeX = 0;
  }

  closeSwipe() {
    this.activeSwipedId = null;
  }
  
  togglePin(event: Event, user: ChatListItem) {
    event.stopPropagation();
    const isPinned = this.pinnedUsers.some(p => p.id === user.id);
    if (isPinned) {
      this.pinnedUsers = this.pinnedUsers.filter(p => p.id !== user.id);
    } else {
      this.pinnedUsers.push(user);
    }
    this.activeSwipedId = null;
    // Save to local storage for persistence
    localStorage.setItem('pinnedUsers', JSON.stringify(this.pinnedUsers.map(p => p.id)));
  }

  toggleSearch() {`);

  // Restore logic for pinnedUsers
  code = code.replace(/this\.syncAndLoad\(\);/,
    `this.syncAndLoad();
    try {
      const stored = localStorage.getItem('pinnedUsers');
      if (stored) {
         this.storedPinnedIds = JSON.parse(stored);
      }
    } catch(e) {}
  `);
  
  code = code.replace(/readonly filteredUsers = computed/,
      `storedPinnedIds: (string|number)[] = [];\n  readonly filteredUsers = computed`);

  // Add the logic to update pinned list when chat users changes
  code = code.replace(/this\._chatUsers\.set\(users\);/, 
    `this._chatUsers.set(users);
        this.pinnedUsers = users.filter(u => this.storedPinnedIds.includes(u.id));`);

  fs.writeFileSync(path, code);
}


# <img src="https://github.com/atokarxd/Slowsenger/blob/main/slowsenger.png" height="30"> Slowsenger – Because your conversation isn't Mark's business either!

Our digital world is scattered. Messenger, Instagram, WhatsApp... we get lost in notifications and jumping between platforms. **Slowsenger** puts an end to this chaos: a world where you can manage all your messages in one place, while we raise security to the highest level!

### Why Slowsenger?

- **Platform Independence:** Don't waste your time switching between apps. Connect Messenger, Instagram, and other accounts, and reply to everyone from a single interface.   
- **Maximum Privacy (P2P):** If you don't trust the servers of big tech giants, use our proprietary **Peer-to-Peer** channel. Here, messages move directly between your device and your friend's device – without intermediate stops or logging.
- **Conscious Communication:** With the "Draft" and delayed messaging functions, you gain control over your messages. Schedule your replies for the right time!  
- **Everything Needed for Chatting:** Seamless handling of GIFs, images, and videos, whether it's a group room or a private conversation.
----------
### 🚀 Tech Stack
-   **_🎨 Frontend:_**  <img src="https://www.svgrepo.com/show/353396/angular-icon.svg" height="25"> **& RxJS**
-   **_💅 Style:_** **Sass**
-   **_⚙️ Backend:_** **NestJS & WebSockets**
-   **_🍃 Database:_** **MongoDB** 
 ----------
### 🗺️ Sitemap
-   **Landing Page**    
    -   Login       
    -   Sign-up    
-   **App Dashboard**
    -   **Messages**
        -   P2P Messages
        -   Messages from other chat applications
        -   Group rooms
    -   **Write to a new recipient**
    -   **Platforms:**
        -   Existing platforms
        -   Add a new platform:
            -   List available platforms
    -   **Profile / Settings**
        -   Edit personal data
----------
### 👥 User Roles
-   **_User:_** Full control over their own platforms and P2P conversations.
-   **_Administration:_** A dedicated interface for maintaining system stability and assisting users (e.g., password reset). The administrator can remotely log out a user from all active sessions. This is a critical security feature if, for example, the user's phone is stolen. In case of violations or abuse, they can place users on temporary or permanent bans. Monitoring platform popularity to see which external platforms (Messenger, Instagram, etc.) users connect to the system most frequently.

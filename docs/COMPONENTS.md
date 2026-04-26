# Slowsenger komponensfa

## Fő komponenshierarchia
- App
  - RouterOutlet
    - WelcomePages
    - Login
    - Regist
    - Dashboard
      - UserList
      - Chat
    - GlobalLoader
    - NotFound

## Útvonalak és betöltött komponensek
- / -> WelcomePages
- /auth/login -> Login
- /auth/registration -> Regist
- /dashboard -> Dashboard
- /loader -> GlobalLoader
- /** -> NotFound

## Megjegyzés
- A Dashboard komponens belső nézete két gyerekkomponenst használ: UserList és Chat.
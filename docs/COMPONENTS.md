# Slowsenger component tree

## Main component hierarchy
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

## Routes and the components they load
- / -> WelcomePages
- /auth/login -> Login
- /auth/registration -> Regist
- /dashboard -> Dashboard
- /loader -> GlobalLoader
- /** -> NotFound

## Note
- The inner view of the Dashboard component uses two child components: UserList and Chat.

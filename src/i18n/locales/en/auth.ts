import type { AuthDict } from '../tr/auth'

export const auth: Record<keyof AuthDict, string> = {
  // Brand panel (AuthLayout)
  'auth.brand.headlineTop': 'Stay in sync',
  'auth.brand.headlineBottom': 'with your team.',
  'auth.brand.subtitle': 'Track tasks, manage lists and make progress together with your team.',
  'auth.brand.feature1': 'Flexible tracking with board and list views',
  'auth.brand.feature2': 'Real-time collaboration, assignments and notifications',
  'auth.brand.feature3': 'Priority, status and due date tracking',
  'auth.brand.feature4': 'Comments, files and subtasks',
  'auth.brand.tagline': 'Make work easy to follow. Move fast.',

  // Fields
  'auth.email': 'E-mail',
  'auth.emailPlaceholder': 'name@company.com',
  'auth.password': 'Password',
  'auth.oldPassword': 'Current password',
  'auth.newPassword': 'New password',
  'auth.minChars': 'At least 6 characters',
  'auth.showPassword': 'Show password',
  'auth.hidePassword': 'Hide password',
  'auth.togglePassword': 'Show or hide password',
  'auth.fullName': 'Full name',
  'auth.fullNamePlaceholder': 'Your full name',

  // Sign in
  'auth.welcomeBack': 'Welcome back',
  'auth.signInSubtitle': 'Sign in to your account',
  'auth.signIn': 'Sign in',
  'auth.signingIn': 'Signing in…',
  'auth.noAccount': 'No account yet?',
  'auth.register': 'Sign up',
  'auth.googleSignIn': 'Sign in with Google',
  'auth.orEmail': 'or with e-mail',
  'auth.changeMyPassword': 'Change my password',

  // Change password
  'auth.changePassword.title': 'Change your password',
  'auth.changePassword.subtitle': 'Confirm with your current password, then set a new one',
  'auth.changePassword.done': 'Your password has been updated. You can sign in with the new one.',
  'auth.updatePassword': 'Update password',
  'auth.updating': 'Updating…',
  'auth.backToSignIn': 'Back to sign in',

  // Register
  'auth.join.title': 'Join Fira',
  'auth.join.subtitle': 'Create your account and join your team',
  'auth.haveAccount': 'Already have an account?',
  'auth.createAccount': 'Create account',
  'auth.registering': 'Creating account…',
  'auth.inviteHint': 'If you came from a team invitation, use the same e-mail address — the invitation is matched automatically.',
  'auth.registerDone.title': 'Account created',
  'auth.registerDone.subtitle': 'One step to go',
  'auth.registerDone.sentBefore': 'A verification link has been sent to ',
  'auth.registerDone.sentAfter': '.',
  'auth.registerDone.hint': 'Once your e-mail is verified you can sign in. Do check the spam folder too.',

  // Errors shown in place of the server's own wording
  'auth.error.invalidCredentials': 'E-mail or password is incorrect.',
  'auth.error.emailNotConfirmed': 'Your e-mail has not been verified yet.',
  'auth.error.tooManyRequests': 'Too many attempts. Please wait a moment.',
  'auth.error.userNotFound': 'No account is registered with this e-mail.',
  'auth.error.signInFailed': 'Sign-in failed',
  'auth.error.passwordMin': 'The new password must be at least 6 characters.',
  'auth.error.oldPasswordWrong': 'The current password is incorrect.',
  'auth.error.alreadyRegistered': 'This e-mail address is already registered. Try signing in.',
  'auth.error.passwordTooShort': 'The password must be at least 6 characters.',
  'auth.error.invalidEmail': 'Invalid e-mail address.',
  'auth.error.signupDisabled': 'Sign-up is closed at the moment. Please contact an administrator.',
  'auth.error.emailRateLimit': 'The e-mail sending limit has been reached. Please wait a few minutes.',
  'auth.error.signUpFailed': 'Sign-up failed',

  // Invitation link
  'auth.invite.checking': 'Checking the invitation…',
  'auth.invite.failed': 'The invitation could not be accepted',
  'auth.invite.joined': 'You have joined the team',
  'auth.invite.joinedBefore': "You're now a member of ",
  'auth.invite.joinedAfter': '.',
  'auth.invite.toBoard': 'Go to the board',
  'auth.invite.invalid': 'Invalid invitation',
  'auth.invite.invalidBody': 'This invitation link has been used, cancelled or has expired.',
  'auth.invite.home': 'Back to the home page',
  'auth.invite.roleBefore': 'You have been invited to this team as ',
  'auth.invite.roleAfter': '.',
  'auth.invite.join': 'Join',
  'auth.invite.joining': 'Joining…',
}

import { SignInForm } from '../components/SignInForm';

export function AdminLogin() {
  return (
    <SignInForm
      title="Admin Sign In"
      description="Authorized administrators only. This account can upload LockerFox exports and update auction records. Everyone else should use the read-only dashboard."
    />
  );
}

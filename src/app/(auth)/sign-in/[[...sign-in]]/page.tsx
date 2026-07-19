import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <SignIn fallbackRedirectUrl="/dashboard" />
    </div>
  );
}

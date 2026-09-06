import { SignIn } from "@clerk/nextjs";
import { isNativeApp } from "@/lib/native-app";

export default async function SignInPage() {
  // Inside the mobile app there is no sign-up (accounts are created on the
  // web, ADR 0032), so the card's "Don't have an account? Sign up" footer
  // goes. Everything else is the same card.
  const inApp = await isNativeApp();
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <SignIn
        fallbackRedirectUrl="/dashboard"
        appearance={
          inApp ? { elements: { footerAction: { display: "none" } } } : undefined
        }
      />
    </div>
  );
}

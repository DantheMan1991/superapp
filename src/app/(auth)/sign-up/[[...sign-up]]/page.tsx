import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { isNativeApp } from "@/lib/native-app";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function SignUpPage() {
  // Accounts are created on the web, never inside the app (ADR 0032): an app
  // that creates accounts must also delete them in front of a reviewer, and
  // a new business's onboarding belongs on a screen with a keyboard anyway.
  // Plain words and no outside link, so nothing here reads as a call to a
  // purchase.
  if (await isNativeApp()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-base">New to Yosher?</CardTitle>
            <CardDescription>
              Businesses join Yosher from a web browser, at yosherapp.com. Once
              your account exists, sign in here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/sign-in" className="text-sm underline">
              Sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <SignUp forceRedirectUrl="/onboarding" />
    </div>
  );
}

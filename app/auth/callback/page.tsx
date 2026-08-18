import type { Metadata } from "next";
import { AuthCallbackHandler } from "@/components/auth-callback-handler";

export const metadata: Metadata = {
  title: "Completing sign-in",
  robots: { index: false, follow: false },
};

export default function AuthCallbackPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--cream)] px-5 py-12">
      <AuthCallbackHandler />
    </main>
  );
}


import type { Metadata } from "next";
import Link from "next/link";
import { SignupFlow } from "@/components/admin/signup-flow";

export const metadata: Metadata = {
  title: "Sign up",
  robots: { index: false, follow: false },
};

/**
 * Signing up. Four steps, and the last three are the gate you will walk back
 * through — you set the patch and the combination on the same two controls that
 * will later ask you for them.
 */
export default function AdminSignupPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
      <p className="eyebrow mb-10 text-center">vibers.tv · new operator</p>
      <SignupFlow />
      <p className="mt-10 text-center font-mono text-[11px] text-faint">
        Already have one?{" "}
        <Link href="/admin/login" className="text-muted transition-colors hover:text-amber">
          Go to the gate
        </Link>
      </p>
    </div>
  );
}

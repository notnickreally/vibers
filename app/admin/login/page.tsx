import type { Metadata } from "next";
import Link from "next/link";
import { Gate } from "@/components/admin/gate";

export const metadata: Metadata = {
  title: "Gate",
  robots: { index: false, follow: false },
};

/**
 * The gate. Three layers, and nothing on this page knows any of the answers.
 *
 * Deliberately static: no cookie is read here, no redirect is made from here.
 * Someone already signed in who lands on this page simply signs in again, which
 * is harmless — and it means this page cannot leak, by redirecting, whether the
 * browser holds a valid session.
 */
export default function AdminLoginPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
      <p className="eyebrow mb-10 text-center">vibers.tv · gallery access</p>
      <Gate />
      <p className="mt-10 text-center font-mono text-[11px] text-faint">
        No account?{" "}
        <Link href="/admin/signup" className="text-muted transition-colors hover:text-amber">
          Sign up with the deployment&apos;s password
        </Link>
      </p>
    </div>
  );
}

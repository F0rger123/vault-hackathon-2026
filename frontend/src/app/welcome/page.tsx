"use client";

import { useRouter } from "next/navigation";
import { PageGate } from "@/components/app-shell";
import { SetupWizard } from "@/components/setup-wizard";

/** The setup guide, reopened by someone already signed in. It skips creating the owner account. */
export default function Page() {
  const router = useRouter();
  return (
    <PageGate>
      <div className="fixed inset-0 z-40 overflow-auto bg-paper">
        <SetupWizard createOwner={false} onFinish={() => router.push("/")} />
      </div>
    </PageGate>
  );
}

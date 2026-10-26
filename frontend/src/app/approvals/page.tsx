import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { ApprovalsView } from "@/components/views/approvals";

export const metadata: Metadata = { title: "Approvals" };

export default function Page() {
  return (
    <PageGate>
      <ApprovalsView />
    </PageGate>
  );
}

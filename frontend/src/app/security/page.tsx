import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { SecurityView } from "@/components/views/security";

export const metadata: Metadata = { title: "Security" };

export default function Page() {
  return (
    <PageGate>
      <SecurityView />
    </PageGate>
  );
}

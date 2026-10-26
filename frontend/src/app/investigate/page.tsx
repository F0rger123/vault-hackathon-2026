import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { InvestigateView } from "@/components/views/investigate";

export const metadata: Metadata = { title: "Investigate" };

export default function Page() {
  return (
    <PageGate>
      <InvestigateView />
    </PageGate>
  );
}

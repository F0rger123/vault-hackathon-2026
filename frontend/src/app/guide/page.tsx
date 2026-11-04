import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { GuideView } from "@/components/views/guide";

export const metadata: Metadata = { title: "How to use VAULT" };

export default function Page() {
  return (
    <PageGate>
      <GuideView />
    </PageGate>
  );
}

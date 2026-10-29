import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { BrainView } from "@/components/views/brain";

export const metadata: Metadata = { title: "Brain" };

export default function Page() {
  return (
    <PageGate>
      <BrainView />
    </PageGate>
  );
}

import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { TrainingView } from "@/components/views/training";

export const metadata: Metadata = { title: "Training" };

export default function Page() {
  return (
    <PageGate>
      <TrainingView />
    </PageGate>
  );
}

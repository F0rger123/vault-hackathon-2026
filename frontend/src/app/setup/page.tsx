import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { SetupView } from "@/components/views/setup";

export const metadata: Metadata = { title: "Set up a run" };

export default function Page() {
  return (
    <PageGate>
      <SetupView />
    </PageGate>
  );
}

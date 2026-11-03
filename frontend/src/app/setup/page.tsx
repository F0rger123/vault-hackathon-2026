import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { SetupView } from "@/components/views/setup";

export const metadata: Metadata = { title: "Add files" };

export default function Page() {
  return (
    <PageGate>
      <SetupView />
    </PageGate>
  );
}

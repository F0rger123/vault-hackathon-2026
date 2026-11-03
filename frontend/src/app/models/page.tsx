import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { ModelsView } from "@/components/views/models";

export const metadata: Metadata = { title: "Models" };

export default function Page() {
  return (
    <PageGate>
      <ModelsView />
    </PageGate>
  );
}

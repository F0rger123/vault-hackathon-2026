import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/loader";
import { BrainView } from "@/components/views/brain";

export const metadata: Metadata = { title: "Brain" };

export default function Page() {
  // The brain reads ?run= (one Ask VAULT reply, or one approval) from the URL, so it renders inside Suspense.
  return (
    <PageGate>
      <Suspense fallback={<LoadingBlock label="Opening the brain" />}>
        <BrainView />
      </Suspense>
    </PageGate>
  );
}

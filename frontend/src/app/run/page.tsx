import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { Suspense } from "react";
import { RunBoardView } from "@/components/views/run-board";
import { LoadingBlock } from "@/components/loader";

export const metadata: Metadata = { title: "Progress" };

export default function Page() {
  // The board reads ?job= from the URL, so it renders on the client inside a Suspense boundary.
  return (
    <PageGate>
      <Suspense fallback={<LoadingBlock label="Opening Progress" />}>
        <RunBoardView />
      </Suspense>
    </PageGate>
  );
}

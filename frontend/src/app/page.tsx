import { PageGate } from "@/components/app-shell";
import { OverviewView } from "@/components/views/overview";

export default function OverviewPage() {
  return (
    <PageGate>
      <OverviewView />
    </PageGate>
  );
}

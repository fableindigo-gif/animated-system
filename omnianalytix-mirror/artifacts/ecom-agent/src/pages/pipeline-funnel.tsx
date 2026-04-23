import { PipelineFunnel } from "@/components/dashboard/pipeline-funnel";

export default function PipelineFunnelPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-screen-2xl mx-auto">
      <PipelineFunnel />
    </div>
  );
}

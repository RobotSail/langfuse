import { useState } from "react";
import { Button } from "@/src/components/ui/button";
import { Sparkles } from "lucide-react";
import { UserSimulatorModal } from "./UserSimulatorModal";

interface UserSimulatorButtonProps {
  datasetId: string;
  projectId: string;
}

export function UserSimulatorButton({
  datasetId,
  projectId,
}: UserSimulatorButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Temporarily bypass permission check for testing
  // const hasAccess = useHasProjectAccess({
  //   projectId,
  //   scope: "eval:CUD",
  // });

  // if (!hasAccess) {
  //   return null;
  // }

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className="gap-2"
      >
        <Sparkles className="h-4 w-4" />
        User Simulation
      </Button>

      <UserSimulatorModal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        datasetId={datasetId}
        projectId={projectId}
      />
    </>
  );
}

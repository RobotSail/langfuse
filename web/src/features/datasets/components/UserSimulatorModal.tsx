import { useState } from "react";
import { useRouter } from "next/router";
import { api } from "@/src/utils/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/src/components/ui/tabs";
import { showSuccessToast } from "@/src/features/notifications/showSuccessToast";
import { Loader, Sparkles, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/src/components/ui/alert";

interface UserSimulatorModalProps {
  open: boolean;
  onClose: () => void;
  datasetId: string;
  projectId: string;
}

export function UserSimulatorModal({
  open,
  onClose,
  datasetId,
  projectId,
}: UserSimulatorModalProps) {
  const router = useRouter();
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [model, setModel] = useState("gpt-4");
  const [endpointType, setEndpointType] = useState<"agent-card" | "direct">(
    "agent-card",
  );
  const [agentCardUrl, setAgentCardUrl] = useState("");
  const [jsonRpcEndpoint, setJsonRpcEndpoint] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "api_key">(
    "none",
  );
  const [authToken, setAuthToken] = useState("");
  const [maxTurns, setMaxTurns] = useState("10");
  const [terminationKeywords, setTerminationKeywords] = useState(
    "goodbye, thank you, that's all",
  );

  const runSimulation = api.userSimulator.runUserSimulation.useMutation({
    onSuccess: (data) => {
      console.log("=== SIMULATION STARTED SUCCESSFULLY ===");
      console.log("Job ID:", data.jobId);
      console.log("Status:", data.status);
      console.log("=====================================");

      showSuccessToast({
        title: "User Simulation Started",
        description: `Job ID: ${data.jobId}. Simulations are running in the background.`,
      });

      // Redirect to traces with session filter
      // User can see results as they come in
      router.push(`/project/${projectId}/traces`);
      onClose();
    },
    onError: (error) => {
      console.error("=== SIMULATION FAILED ===");
      console.error("Error:", error);
      console.error("Error message:", error.message);
      console.error("Error shape:", error.shape);
      console.error("========================");
    },
  });

  const testConnection = api.userSimulator.testAgentConnection.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        showSuccessToast({
          title: "A2A Connection Successful",
          description: "Agent endpoint is reachable via A2A protocol",
        });
      } else {
        console.error("A2A connection failed:", data.error);
        if ((data as any).errorDetails) {
          console.error("Error details:", (data as any).errorDetails);
        }
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    console.log("=== FORM SUBMIT TRIGGERED ===");
    console.log("OpenAI Key:", openaiApiKey ? "present" : "missing");
    console.log("Endpoint Type:", endpointType);
    console.log("Agent Card URL:", agentCardUrl);
    console.log("JSON RPC Endpoint:", jsonRpcEndpoint);
    console.log("Auth Type:", authType);
    console.log("Auth Token:", authToken ? "present" : "missing");

    if (!openaiApiKey) {
      console.log("VALIDATION FAILED: No OpenAI API Key");
      return;
    }

    if (endpointType === "agent-card" && !agentCardUrl) {
      console.log("VALIDATION FAILED: No Agent Card URL");
      return;
    }

    if (endpointType === "direct" && !jsonRpcEndpoint) {
      console.log("VALIDATION FAILED: No JSON RPC Endpoint");
      return;
    }

    console.log("VALIDATION PASSED - Calling runSimulation.mutate()");

    runSimulation.mutate({
      projectId,
      datasetId,
      config: {
        datasetId, // Required by UserSimulationEvalConfigSchema
        openaiApiKey,
        modelConfig: {
          model,
          temperature: 0.7,
        },
        agentEndpoint: {
          ...(endpointType === "agent-card"
            ? { agentCardUrl }
            : { jsonRpcEndpoint }),
          authType,
          ...(authType !== "none" && authToken ? { authToken } : {}),
          timeout: 30000,
        },
        terminationConditions: {
          keywords: terminationKeywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        },
        datasetFilter: [],
      },
    });
  };

  const handleTestConnection = () => {
    if (endpointType === "agent-card" && !agentCardUrl) return;
    if (endpointType === "direct" && !jsonRpcEndpoint) return;

    testConnection.mutate({
      projectId,
      agentEndpoint: {
        ...(endpointType === "agent-card"
          ? { agentCardUrl }
          : { jsonRpcEndpoint }),
        authType,
        ...(authType !== "none" && authToken ? { authToken } : {}),
        timeout: 10000,
      },
    });
  };

  const isFormValid = () => {
    if (!openaiApiKey) return false;
    if (endpointType === "agent-card" && !agentCardUrl) return false;
    if (endpointType === "direct" && !jsonRpcEndpoint) return false;
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Run User Simulation (A2A Protocol)
          </DialogTitle>
          <DialogDescription>
            Configure automated user simulations using A2A protocol. The
            simulator will communicate with your agent using JSON-RPC 2.0 and
            trace all interactions to Langfuse.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            This simulator uses the{" "}
            <strong>A2A (Agent-to-Agent) protocol</strong> to communicate with
            your agent. Your agent must implement the A2A JSON-RPC 2.0
            specification.
          </AlertDescription>
        </Alert>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* OpenAI Configuration */}
          <div className="space-y-2">
            <Label htmlFor="openai-key">OpenAI API Key *</Label>
            <Input
              id="openai-key"
              type="password"
              placeholder="sk-..."
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              required
            />
            <p className="text-sm text-muted-foreground">
              Used for the user simulator LLM
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="model">Simulator Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4">GPT-4</SelectItem>
                <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                <SelectItem value="gpt-4.1-mini">gpt-4.1-mini</SelectItem>
                <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* A2A Agent Configuration */}
          <div className="space-y-2">
            <Label>A2A Agent Configuration *</Label>
            <Tabs
              value={endpointType}
              onValueChange={(v) =>
                setEndpointType(v as "agent-card" | "direct")
              }
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="agent-card">
                  Agent Card Discovery
                </TabsTrigger>
                <TabsTrigger value="direct">Direct JSON-RPC</TabsTrigger>
              </TabsList>

              <TabsContent value="agent-card" className="space-y-2">
                <Label htmlFor="agent-card-url">Agent Card URL *</Label>
                <div className="flex gap-2">
                  <Input
                    id="agent-card-url"
                    type="url"
                    placeholder="https://your-agent.com/.well-known/agent.json"
                    value={agentCardUrl}
                    onChange={(e) => setAgentCardUrl(e.target.value)}
                    required={endpointType === "agent-card"}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={!agentCardUrl || testConnection.isPending}
                  >
                    {testConnection.isPending ? (
                      <Loader className="h-4 w-4 animate-spin" />
                    ) : (
                      "Test"
                    )}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  URL to the agent&apos;s A2A Agent Card (e.g.,
                  https://example.com/.well-known/agent.json)
                </p>
              </TabsContent>

              <TabsContent value="direct" className="space-y-2">
                <Label htmlFor="jsonrpc-endpoint">JSON-RPC Endpoint *</Label>
                <div className="flex gap-2">
                  <Input
                    id="jsonrpc-endpoint"
                    type="url"
                    placeholder="https://your-agent.com/jsonrpc"
                    value={jsonRpcEndpoint}
                    onChange={(e) => setJsonRpcEndpoint(e.target.value)}
                    required={endpointType === "direct"}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={!jsonRpcEndpoint || testConnection.isPending}
                  >
                    {testConnection.isPending ? (
                      <Loader className="h-4 w-4 animate-spin" />
                    ) : (
                      "Test"
                    )}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Direct URL to the agent&apos;s JSON-RPC 2.0 endpoint
                </p>
              </TabsContent>
            </Tabs>
          </div>

          {/* Authentication */}
          <div className="space-y-2">
            <Label htmlFor="auth-type">Authentication</Label>
            <Select
              value={authType}
              onValueChange={(v) => setAuthType(v as typeof authType)}
            >
              <SelectTrigger id="auth-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="api_key">API Key</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {authType !== "none" && (
            <div className="space-y-2">
              <Label htmlFor="auth-token">
                {authType === "bearer" ? "Bearer Token" : "API Key"}
              </Label>
              <Input
                id="auth-token"
                type="password"
                placeholder={
                  authType === "bearer" ? "your-bearer-token" : "your-api-key"
                }
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
              />
            </div>
          )}

          {/* Conversation Settings */}
          <div className="space-y-2">
            <Label htmlFor="max-turns">Max Turns per Conversation</Label>
            <Input
              id="max-turns"
              type="number"
              min="1"
              max="50"
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="keywords">
              Termination Keywords (comma-separated)
            </Label>
            <Input
              id="keywords"
              placeholder="goodbye, thank you, that's all"
              value={terminationKeywords}
              onChange={(e) => setTerminationKeywords(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Simulation stops if the simulator says any of these keywords
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isFormValid() || runSimulation.isPending}
            >
              {runSimulation.isPending ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                "Run Simulation"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

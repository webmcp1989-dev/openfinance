type WebMcpJsonSchema = Readonly<Record<string, unknown>>;

type WebMcpTool = Readonly<{
  name: string;
  description: string;
  inputSchema: WebMcpJsonSchema;
  annotations?: Readonly<{ readOnlyHint?: boolean }>;
  execute: (input: unknown) => Promise<unknown> | unknown;
}>;

interface DocumentModelContext {
  registerTool(tool: WebMcpTool): Promise<void> | void;
  unregisterTool?(name: string): Promise<void> | void;
}

interface Document {
  modelContext?: DocumentModelContext;
}

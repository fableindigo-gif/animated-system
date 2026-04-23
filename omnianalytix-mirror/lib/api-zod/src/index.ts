// The auto-generated `api.ts` file (zod schemas) and the `types/` barrel both
// declare some of the same names (CreateConnectionBody, GenerateGeminiImageBody,
// etc.). The zod schemas in `api.ts` are the source of truth — they provide
// both runtime validators and inferred types. The `types/` barrel only adds
// types that aren't already in `api.ts`.
export * from "./generated/api";

export type {
  AllPlatformData,
  ConnectionTestResult,
  CreateConnectionBodyCredentials,
  GeminiConversation,
  GeminiConversationWithMessages,
  GeminiError,
  GeminiMessage,
  HealthStatus,
  PlatformConnection,
  PlatformDataResult,
  PlatformDataResultData,
} from "./generated/types";

// CreateConnectionBodyPlatform is exported as both a type and a const enum
// object — re-export the value form so callers get both runtime + type.
export { CreateConnectionBodyPlatform } from "./generated/types";

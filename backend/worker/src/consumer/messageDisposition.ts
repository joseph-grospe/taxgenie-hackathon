export type MessageDisposition =
  | { kind: "acknowledge" }
  | { kind: "retry"; reason: string }
  | {
      kind: "poison";
      reason: string;
      validationIssues?: Array<{ code: string; path: string }>;
    };

import { Type } from "@sinclair/typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { create, all } from "mathjs";

const math = create(all);
const disabled = (name: string) => () => {
  throw new Error(`Function ${name} is disabled`);
};
math.import(
  {
    import: disabled("import"),
    createUnit: disabled("createUnit"),
    evaluate: disabled("evaluate"),
    parse: disabled("parse"),
    simplify: disabled("simplify"),
    derivative: disabled("derivative"),
  },
  { override: true },
);

const EVALUATE_TIMEOUT_MS = 1_000;

function evaluateWithTimeout(expression: string, scope?: Record<string, unknown>): unknown {
  const deadline = Date.now() + EVALUATE_TIMEOUT_MS;
  const node = math.parse(expression);
  node.traverse(() => {
    if (Date.now() > deadline) throw new Error(`expression parse exceeded ${EVALUATE_TIMEOUT_MS}ms`);
  });
  const compiled = node.compile();
  return compiled.evaluate(scope);
}

export function createUtilTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "calc",
      label: "calc",
      description: "Evaluate a math expression using mathjs. Supports arithmetic, functions (sin/cos/log/sqrt/...), units (e.g. `3 inch to cm`), matrices, BigNumber precision (e.g. `bignumber(0.1) + bignumber(0.2)`), and boolean logic. Optional `scope` provides variable bindings. Returns the result as a string.",
      parameters: Type.Object({
        expression: Type.String({ description: "mathjs expression to evaluate" }),
        scope: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "variable bindings available inside the expression" })),
      }),
      async execute(_toolCallId, params) {
        const { expression, scope } = params as { expression: string; scope?: Record<string, unknown> };
        try {
          const result = evaluateWithTimeout(expression, scope);
          const text = typeof result === "string" ? result : math.format(result, { precision: 14 });
          return { content: [{ type: "text", text }], details: { result: text, error: undefined as string | undefined } };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `error: ${message}` }], details: { result: "", error: message }, isError: true };
        }
      },
    }),
  ];
}

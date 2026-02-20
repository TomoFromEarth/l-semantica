export interface GoalAstNode {
  kind: "GoalDeclaration";
  value: string;
}

export function parseGoalDeclaration(input: string): GoalAstNode {
  const normalized = input.trim();
  if (normalized.length === 0) {
    throw new Error("Goal declaration cannot be empty");
  }

  return {
    kind: "GoalDeclaration",
    value: normalized
  };
}

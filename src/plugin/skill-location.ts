import type { AvailableSkill } from "../agents/dynamic-agent-prompt-builder";
import type { SkillScope } from "../features/opencode-skill-loader/types";

export function mapScopeToLocation(scope: SkillScope): AvailableSkill["location"] {
  if (scope === "user" || scope === "opencode") return "user";
  if (scope === "project" || scope === "opencode-project") return "project";
  return "plugin";
}

import type { AvailableSkill } from "../agents/dynamic-agent-prompt-builder";
import type { OhMyOpenCodeConfig } from "../config";
import type { BrowserAutomationProvider } from "../config/schema";

import {
  discoverOpencodeGlobalSkills,
  discoverOpencodeProjectSkills,
  discoverProjectClaudeSkills,
  discoverUserClaudeSkills,
  mergeSkills,
} from "../features/opencode-skill-loader";
import { createBuiltinSkills } from "../features/builtin-skills";
import { getSystemMcpServerNames } from "../features/claude-code-mcp-loader";
import { mapScopeToLocation } from "./skill-location";

export interface SkillsState {
  browserProvider: BrowserAutomationProvider;
  disabledSkills: Set<string>;
  mergedSkills: ReturnType<typeof mergeSkills>;
  availableSkills: AvailableSkill[];
}

export async function createSkillsState(
  pluginConfig: OhMyOpenCodeConfig,
): Promise<SkillsState> {
  const browserProvider: BrowserAutomationProvider =
    pluginConfig.browser_automation_engine?.provider ?? "playwright";
  const disabledSkills = new Set<string>(pluginConfig.disabled_skills ?? []);
  const systemMcpNames = getSystemMcpServerNames();

  const builtinSkills = createBuiltinSkills({ browserProvider, disabledSkills }).filter(
    (skill) => {
      if (skill.mcpConfig) {
        for (const mcpName of Object.keys(skill.mcpConfig)) {
          if (systemMcpNames.has(mcpName)) return false;
        }
      }
      return true;
    },
  );

  const includeClaudeSkills = pluginConfig.claude_code?.skills !== false;
  const [userSkills, globalSkills, projectSkills, opencodeProjectSkills] =
    await Promise.all([
      includeClaudeSkills ? discoverUserClaudeSkills() : Promise.resolve([]),
      discoverOpencodeGlobalSkills(),
      includeClaudeSkills ? discoverProjectClaudeSkills() : Promise.resolve([]),
      discoverOpencodeProjectSkills(),
    ]);

  const mergedSkills = mergeSkills(
    builtinSkills,
    pluginConfig.skills,
    userSkills,
    globalSkills,
    projectSkills,
    opencodeProjectSkills,
  );

  const availableSkills: AvailableSkill[] = mergedSkills.map((skill) => ({
    name: skill.name,
    description: skill.definition.description ?? "",
    location: mapScopeToLocation(skill.scope),
  }));

  return { browserProvider, disabledSkills, mergedSkills, availableSkills };
}

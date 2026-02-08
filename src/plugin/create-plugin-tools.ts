import type { ToolDefinition } from "@opencode-ai/plugin";

import type { HookName, OhMyOpenCodeConfig } from "../config";

import { getMainSessionID } from "../features/claude-code-session-state";
import { SkillMcpManager } from "../features/skill-mcp-manager";
import type { BackgroundManager } from "../features/background-agent";
import type { TmuxSessionManager } from "../features/tmux-subagent";

import {
  builtinTools,
  createBackgroundTools,
  createCallOmoAgent,
  createDelegateTask,
  createLookAt,
  createSkillMcpTool,
  createSkillTool,
  createSlashcommandTool,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskList,
  createTaskUpdateTool,
  discoverCommandsSync,
  interactive_bash,
} from "../tools";
import {
  CATEGORY_DESCRIPTIONS,
  DEFAULT_CATEGORIES,
} from "../tools/delegate-task/constants";
import { filterDisabledTools } from "../shared/disabled-tools";
import { log } from "../shared";
import { createConfigHandler } from "../plugin-handlers";
import type { ModelCacheState } from "../plugin-state";
import { createSkillsState } from "./create-skills-state";
import {
  createAutoSlashCommandHook,
  createCategorySkillReminderHook,
} from "../hooks";
import type { PluginContext } from "./plugin-types";

export interface CreatePluginToolsDeps {
  ctx: Pick<PluginContext, "directory" | "client">;
  pluginConfig: OhMyOpenCodeConfig;
  modelCacheState: ModelCacheState;
  backgroundManager: BackgroundManager;
  tmuxSessionManager: TmuxSessionManager;
  isHookEnabled: (hookName: HookName) => boolean;
}

export interface CreatePluginToolsResult {
  filteredTools: Record<string, ToolDefinition>;
  configHandler: ReturnType<typeof createConfigHandler>;
  categorySkillReminder: unknown;
  autoSlashCommand: unknown;
  skillMcpManager: SkillMcpManager;
}

export async function createPluginTools(
  deps: CreatePluginToolsDeps,
): Promise<CreatePluginToolsResult> {
  const { ctx, pluginConfig } = deps;

  const backgroundTools = createBackgroundTools(deps.backgroundManager, ctx.client);
  const callOmoAgent = createCallOmoAgent(ctx as unknown as PluginContext, deps.backgroundManager);

  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  );
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx as unknown as PluginContext) : null;

  const { browserProvider, disabledSkills, mergedSkills, availableSkills } =
    await createSkillsState(pluginConfig);

  const mergedCategories = pluginConfig.categories
    ? { ...DEFAULT_CATEGORIES, ...pluginConfig.categories }
    : DEFAULT_CATEGORIES;

  const availableCategories = Object.entries(mergedCategories).map(
    ([name, categoryConfig]) => ({
      name,
      description:
        pluginConfig.categories?.[name]?.description ??
        CATEGORY_DESCRIPTIONS[name] ??
        "General tasks",
      model: categoryConfig.model,
    }),
  );

  const delegateTask = createDelegateTask({
    manager: deps.backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.["sisyphus-junior"]?.model,
    browserProvider,
    disabledSkills,
    availableCategories,
    availableSkills,
    onSyncSessionCreated: async (event) => {
      log("[index] onSyncSessionCreated callback", {
        sessionID: event.sessionID,
        parentID: event.parentID,
        title: event.title,
      });
      await deps.tmuxSessionManager.onSessionCreated({
        type: "session.created",
        properties: {
          info: {
            id: event.sessionID,
            parentID: event.parentID,
            title: event.title,
          },
        },
      });
    },
  });

  const categorySkillReminder = deps.isHookEnabled("category-skill-reminder")
    ? createCategorySkillReminderHook(ctx as unknown as PluginContext, availableSkills)
    : null;

  const skillMcpManager = new SkillMcpManager();
  const getSessionIDForMcp = () => getMainSessionID() || "";
  const skillTool = createSkillTool({
    skills: mergedSkills,
    mcpManager: skillMcpManager,
    getSessionID: getSessionIDForMcp,
    gitMasterConfig: pluginConfig.git_master,
    disabledSkills,
  });
  const skillMcpTool = createSkillMcpTool({
    manager: skillMcpManager,
    getLoadedSkills: () => mergedSkills,
    getSessionID: getSessionIDForMcp,
  });

  const commands = discoverCommandsSync();
  const slashcommandTool = createSlashcommandTool({
    commands,
    skills: mergedSkills,
  });

  const autoSlashCommand = deps.isHookEnabled("auto-slash-command")
    ? createAutoSlashCommandHook({ skills: mergedSkills })
    : null;

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState: deps.modelCacheState,
  });

  const taskSystemEnabled = pluginConfig.experimental?.task_system ?? false;
  const taskToolsRecord: Record<string, ToolDefinition> = taskSystemEnabled
    ? {
        task_create: createTaskCreateTool(pluginConfig, ctx as unknown as PluginContext),
        task_get: createTaskGetTool(pluginConfig),
        task_list: createTaskList(pluginConfig),
        task_update: createTaskUpdateTool(pluginConfig, ctx as unknown as PluginContext),
      }
    : {};

  const allTools: Record<string, ToolDefinition> = {
    ...builtinTools,
    ...backgroundTools,
    call_omo_agent: callOmoAgent,
    ...(lookAt ? { look_at: lookAt } : {}),
    task: delegateTask,
    skill: skillTool,
    skill_mcp: skillMcpTool,
    slashcommand: slashcommandTool,
    interactive_bash,
    ...taskToolsRecord,
  };

  const filteredTools: Record<string, ToolDefinition> = filterDisabledTools(
    allTools,
    pluginConfig.disabled_tools,
  );

  return {
    filteredTools,
    configHandler,
    categorySkillReminder,
    autoSlashCommand,
    skillMcpManager,
  };
}

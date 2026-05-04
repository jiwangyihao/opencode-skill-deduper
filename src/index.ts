import type { Plugin } from "@opencode-ai/plugin";

import { dedupeSkillMessages, logDedupeStats } from "./dedupe.js";

export type { SkillDedupeResult, SkillElideStat } from "./dedupe.js";
export { dedupeSkillMessages } from "./dedupe.js";

export const SkillDeduperPlugin: Plugin = async () => {
	return {
		"experimental.chat.messages.transform": async (_input, output) => {
			logDedupeStats(dedupeSkillMessages(output));
		},
	};
};

export default SkillDeduperPlugin;

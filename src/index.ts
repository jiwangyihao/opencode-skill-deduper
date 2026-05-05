import type { Plugin } from "@opencode-ai/plugin";

import {
	createDedupeNotificationMessage,
	dedupeSkillMessages,
	logDedupeStats,
} from "./dedupe.js";

export type { SkillDedupeResult, SkillElideStat } from "./dedupe.js";
export { dedupeSkillMessages } from "./dedupe.js";

export const SkillDeduperPlugin: Plugin = async (ctx) => {
	return {
		"experimental.chat.messages.transform": async (_input, output) => {
			const result = dedupeSkillMessages(output);
			const notificationMessage = createDedupeNotificationMessage(result);

			try {
				await logDedupeStats(result, async (record) => {
					await ctx.client.app.log({ body: record });
				});
			} catch {
				// Recording must never affect message transformation.
			}

			if (!notificationMessage) return;

			try {
				await ctx.client.tui.showToast({
					body: {
						title: "Skill Deduper",
						message: notificationMessage,
						variant: "info",
						duration: 5000,
					},
				});
			} catch {
				// TUI notification must never affect message transformation.
			}
		},
	};
};

export default SkillDeduperPlugin;

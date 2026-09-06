/**
 * opsx-pipeline — PROJECT-LOCAL orchestrator → worker pipeline for OpenSpec.
 *
 * Lives in .pi/extensions/ so it only loads for this repository. It never
 * writes to ~/.pi or any global config.
 *
 * The pattern:
 *   - The main session (your smart/large-context model, e.g. Kimi) is the
 *     ORCHESTRATOR. It runs the openspec-propose / explore / update / archive
 *     skills and reviews the worker's output.
 *   - `opsx_implement` delegates implementation to an ISOLATED cheap worker:
 *     a separate `pi --mode json -p --no-session --model <workerModel>`
 *     process with restricted tools (no subagent tool → no recursion).
 *     The worker loads the same project-local openspec skills and applies
 *     the change end-to-end, checking off tasks.md as it goes.
 *
 * Usage:
 *   /opsx-run add a REST endpoint for trips     → full pipeline runbook
 *                                                 (propose → implement → review → archive),
 *                                                 driven by the orchestrator model.
 *   /opsx-implement <change-name>               → manual one-shot worker run.
 *   The orchestrator can also call the `opsx_implement` / `opsx_status`
 *   tools directly at any time.
 *
 * Config (optional): .pi/opsx-pipeline.json
 *   {
 *     "workerModel": "openrouter/z-ai/glm-5.3-flash",
 *     "workerThinking": "off",                  // optional
 *     "workerTimeoutMs": 1200000,               // 20 min hard kill
 *     "workerTools": ["read","bash","edit","write","grep","find","ls"]
 *   }
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface PipelineConfig {
	workerModel: string;
	workerThinking?: string;
	workerTimeoutMs: number;
	workerTools: string[];
}

const DEFAULT_CONFIG: PipelineConfig = {
	workerModel: "openrouter/z-ai/glm-5.3-flash",
	workerTimeoutMs: 20 * 60 * 1000,
	workerTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
};

function loadConfig(cwd: string): PipelineConfig {
	const configPath = path.join(cwd, CONFIG_DIR_NAME, "opsx-pipeline.json");
	try {
		const raw = fs.readFileSync(configPath, "utf8");
		return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<PipelineConfig>) };
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

// ---------------------------------------------------------------------------
// Worker process plumbing (mirrors examples/extensions/subagent/index.ts)
// ---------------------------------------------------------------------------

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

interface WorkerResult {
	change: string;
	model: string;
	exitCode: number;
	report: string;
	stderr: string;
	usage: UsageStats;
	toolCalls: number;
	timedOut: boolean;
	aborted: boolean;
}

interface WorkerDetails extends WorkerResult {
	extraInstructions?: string;
}

const REPORT_CAP = 50 * 1024;

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsage(usage: UsageStats, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

function finalText(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

function buildWorkerPrompt(change: string, cwd: string, extraInstructions?: string): string {
	return `You are an implementation worker. Apply the OpenSpec change "${change}" in the repository at ${cwd}.

Follow this protocol exactly:
1. Run: openspec instructions apply --change "${change}" --json
2. Read every file listed in contextFiles (proposal, specs, design, tasks) BEFORE editing any code.
3. Implement the tasks in order. After finishing each task, mark it complete in the tasks.md file (- [ ] → - [x]).
4. Stay strictly within the scope of the spec and the tasks. Do not refactor unrelated code, do not add features that are not specified.
5. If the project has an obvious fast verification step for the touched area (typecheck, lint, focused tests), run it and include the result in your report.
6. If a task is ambiguous, contradicts the design, or the spec seems wrong, STOP and report the problem instead of guessing.
${extraInstructions ? `\nAdditional instructions from the orchestrator:\n${extraInstructions}\n` : ""}
When finished (or blocked), end with a final report in exactly this format:

## Report
- Status: completed | blocked
- Tasks completed: <n>/<m>
- Files changed: <comma-separated list>
- Verification: <what you ran and the result, or "none">
- Issues: <problems, deviations, or blockers; "none" if clean>`;
}

async function runWorker(
	cwd: string,
	config: PipelineConfig,
	change: string,
	extraInstructions: string | undefined,
	modelOverride: string | undefined,
	signal: AbortSignal | undefined,
	onUpdate: ((text: string, details: WorkerDetails) => void) | undefined,
): Promise<WorkerResult> {
	const model = modelOverride ?? config.workerModel;
	const prompt = buildWorkerPrompt(change, cwd, extraInstructions);

	const args: string[] = ["--mode", "json", "-p", "--no-session", "--model", model];
	if (config.workerThinking) args.push("--thinking", config.workerThinking);
	if (config.workerTools.length > 0) args.push("--tools", config.workerTools.join(","));
	args.push(prompt);

	const result: WorkerResult = {
		change,
		model,
		exitCode: -1,
		report: "",
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
		toolCalls: 0,
		timedOut: false,
		aborted: false,
	};
	const messages: Message[] = [];
	let lastTool = "";

	const emit = () => {
		if (!onUpdate) return;
		const progress =
			`worker running… ${result.usage.turns} turns, ${result.toolCalls} tool calls` +
			(lastTool ? `, last: ${lastTool}` : "");
		onUpdate(progress, { ...result, extraInstructions });
	};

	const exitCode = await new Promise<number>((resolve) => {
		const invocation = getPiInvocation(args);
		const proc = spawn(invocation.command, invocation.args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PI_OPSX_WORKER: "1" },
		});

		let buffer = "";
		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event.type === "message_end" && event.message) {
				const msg = event.message as Message;
				messages.push(msg);
				if (msg.role === "assistant") {
					result.usage.turns++;
					const usage = (msg as any).usage;
					if (usage) {
						result.usage.input += usage.input || 0;
						result.usage.output += usage.output || 0;
						result.usage.cacheRead += usage.cacheRead || 0;
						result.usage.cacheWrite += usage.cacheWrite || 0;
						result.usage.cost += usage.cost?.total || 0;
					}
					for (const part of msg.content) {
						if (part.type === "toolCall") {
							result.toolCalls++;
							lastTool = part.name;
						}
					}
				}
				emit();
			}
			if (event.type === "tool_result_end" && event.message) {
				messages.push(event.message as Message);
				emit();
			}
		};

		proc.stdout.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		});
		proc.stderr.on("data", (data) => {
			result.stderr += data.toString();
		});
		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			resolve(code ?? 0);
		});
		proc.on("error", () => resolve(1));

		const kill = () => {
			proc.kill("SIGTERM");
			setTimeout(() => {
				if (!proc.killed) proc.kill("SIGKILL");
			}, 5000);
		};
		const timeout = setTimeout(() => {
			result.timedOut = true;
			kill();
		}, config.workerTimeoutMs);
		proc.on("close", () => clearTimeout(timeout));

		if (signal) {
			const onAbort = () => {
				result.aborted = true;
				kill();
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}
	});

	result.exitCode = exitCode;
	result.report = finalText(messages);
	if (!result.report && result.stderr) {
		result.report = `(no assistant output)\n\nstderr:\n${result.stderr.slice(-2000)}`;
	}
	if (Buffer.byteLength(result.report, "utf8") > REPORT_CAP) {
		result.report = `${result.report.slice(0, REPORT_CAP)}\n\n[report truncated at 50KB]`;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// Small banner so it's obvious the project-local pipeline is active.
	pi.on("session_start", async (event, ctx) => {
		if (event.reason === "startup" || event.reason === "reload") {
			const config = loadConfig(ctx.cwd);
			ctx.ui.setStatus("opsx", `opsx ⛓ worker: ${config.workerModel}`);
		}
	});

	// -- Tool: opsx_implement -------------------------------------------------

	pi.registerTool({
		name: "opsx_implement",
		label: "OpenSpec Implement",
		description:
			"Apply an OpenSpec change by spawning an isolated worker process (cheap model, restricted tools) " +
			"that reads the change artifacts, implements every task, and checks them off in tasks.md. " +
			"Use this to DELEGATE implementation; the caller stays responsible for proposing, reviewing, and archiving.",
		promptSnippet: "Delegate implementation of an OpenSpec change to an isolated worker model",
		promptGuidelines: [
			"Use opsx_implement to implement an OpenSpec change instead of writing the implementation yourself; you remain the orchestrator and reviewer.",
			"Use opsx_implement only after the change has been proposed and validated (openspec validate <name> --strict).",
			"Use opsx_status when you need the pending/completed task counts for an OpenSpec change.",
		],
		parameters: Type.Object({
			change: Type.String({ description: "OpenSpec change name (kebab-case directory under openspec/changes/)" }),
			model: Type.Optional(
				Type.String({ description: "Override worker model for this run (e.g. provider/model-id)" }),
			),
			extraInstructions: Type.Optional(
				Type.String({
					description:
						"Extra guidance for the worker, e.g. fixes after a failed review or a description of what went wrong last run",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const config = loadConfig(ctx.cwd);

			// Fail fast if the change doesn't exist.
			const status = await pi.exec("openspec", ["status", "--change", params.change], { signal });
			if (status.code !== 0) {
				const list = await pi.exec("openspec", ["list"], { signal });
				throw new Error(
					`Unknown OpenSpec change "${params.change}". openspec status failed.\n${status.stderr || status.stdout}\nActive changes:\n${list.stdout}`,
				);
			}

			const result = await runWorker(
				ctx.cwd,
				config,
				params.change,
				params.extraInstructions,
				params.model,
				signal,
				onUpdate
					? (text, details) =>
							onUpdate({ content: [{ type: "text", text }], details: details as unknown as Record<string, unknown> })
					: undefined,
			);

			const failed = result.exitCode !== 0 || result.timedOut || result.aborted;
			const header = failed
				? `Worker FAILED for change "${params.change}" (${result.timedOut ? "timeout" : result.aborted ? "aborted" : `exit ${result.exitCode}`}).`
				: `Worker finished change "${params.change}".`;

			// NOTE: a failed worker run is returned as a normal result (not thrown) so the
			// orchestrator model receives the full report and can decide the next step.
			return {
				content: [
					{
						type: "text",
						text:
							`${header}\nWorker model: ${result.model}\nUsage: ${formatUsage(result.usage)}\n\n` +
							`${result.report}\n\n` +
							`Orchestrator next steps: review the diff (git status / git diff), verify tasks.md is fully checked off, ` +
							`then either fix issues yourself, re-run opsx_implement with extraInstructions, or archive the change.`,
					},
				],
				details: { ...result, extraInstructions: params.extraInstructions },
			};
		},

		renderCall(args, theme) {
			let text =
				theme.fg("toolTitle", theme.bold("opsx_implement ")) + theme.fg("accent", String(args.change ?? "..."));
			if (args.model) text += theme.fg("muted", ` [${args.model}]`);
			if (args.extraInstructions) text += `\n  ${theme.fg("dim", `+instructions: ${String(args.extraInstructions).slice(0, 60)}…`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) {
				const text = result.content[0];
				return new Text(theme.fg("warning", text?.type === "text" ? text.text : "worker running…"), 0, 0);
			}
			const details = result.details as WorkerDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}
			const failed = details.exitCode !== 0 || details.timedOut || details.aborted;
			const icon = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
			let header = `${icon} ${theme.fg("toolTitle", theme.bold("worker"))} ${theme.fg("accent", details.change)}`;
			header += theme.fg("dim", `  ${formatUsage(details.usage, details.model)}`);
			if (!expanded) {
				const lines = details.report.split("\n").slice(0, 8).join("\n");
				return new Text(`${header}\n${theme.fg("toolOutput", lines)}\n${theme.fg("muted", "(Ctrl+O to expand)")}`, 0, 0);
			}
			const container = new Container();
			container.addChild(new Text(header, 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("toolOutput", details.report || "(no report)"), 0, 0));
			return container;
		},
	});

	// -- Tool: opsx_status ----------------------------------------------------

	pi.registerTool({
		name: "opsx_status",
		label: "OpenSpec Status",
		description:
			"Show OpenSpec status: pending/completed task counts for a change, or the list of active changes when no change is given.",
		promptSnippet: "Show OpenSpec change list or per-change task progress",
		parameters: Type.Object({
			change: Type.Optional(Type.String({ description: "Change name; omit to list all active changes" })),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const args = params.change ? ["status", "--change", params.change] : ["list"];
			const res = await pi.exec("openspec", args, { signal });
			if (res.code !== 0) {
				throw new Error(`openspec ${args.join(" ")} failed:\n${res.stderr || res.stdout}`);
			}
			return { content: [{ type: "text", text: res.stdout.trim() || "(no output)" }], details: {} };
		},
	});

	// -- Command: /opsx-run ---------------------------------------------------

	pi.registerCommand("opsx-run", {
		description: "Run the full orchestrator→worker pipeline for a feature: propose (this model) → implement (worker) → review → archive",
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /opsx-run <feature description>", "error");
				return;
			}
			const config = loadConfig(ctx.cwd);
			const runbook = `You are the ORCHESTRATOR in an orchestrator→worker pipeline. Goal: ${goal}

Follow these phases strictly and sequentially:

PHASE 1 — PROPOSE (you): Load the openspec-propose skill and create a complete change proposal (proposal, specs, design, tasks). Pick a verb-led kebab-case change name. Run \`openspec validate <name> --strict --no-interactive\` and fix any issues. Give a short summary (why/what/tasks count) and state the change name.

PHASE 2 — IMPLEMENT (delegate): Call the opsx_implement tool with the change name. Do NOT implement any of the tasks yourself — the worker (model: ${config.workerModel}) does that in an isolated process.

PHASE 3 — REVIEW (you): Inspect the worker's report and the actual diff (git status / git diff / read the touched files). Verify tasks.md is fully checked off (opsx_status). If there are minor issues, fix them yourself. If the worker went off-track, call opsx_implement again with extraInstructions describing what to fix. If the plan itself is wrong, load openspec-update-change, revise, then re-implement.

PHASE 4 — FINALIZE: Ask me for confirmation, then load the openspec-archive-change skill to archive the change.

Rules:
- Stop briefly after each phase and report before continuing.
- Never implement spec'd tasks yourself; always delegate via opsx_implement.
- If anything is ambiguous or risky, ask me instead of guessing.`;
			pi.sendUserMessage(runbook);
		},
	});

	// -- Command: /opsx-implement ----------------------------------------------

	pi.registerCommand("opsx-implement", {
		description: "Manually spawn the worker to apply an OpenSpec change (bypasses the orchestrator)",
		handler: async (args, ctx) => {
			const change = args.trim();
			if (!change) {
				ctx.ui.notify("Usage: /opsx-implement <change-name>", "error");
				return;
			}
			const config = loadConfig(ctx.cwd);
			ctx.ui.notify(`Spawning worker (${config.workerModel}) for "${change}"…`, "info");
			const result = await runWorker(ctx.cwd, config, change, undefined, undefined, undefined, (text) => {
				ctx.ui.setStatus("opsx", text);
			});
			ctx.ui.setStatus("opsx", `opsx ⛓ worker: ${config.workerModel}`);
			const failed = result.exitCode !== 0 || result.timedOut || result.aborted;
			ctx.ui.notify(
				failed ? `Worker failed for "${change}"` : `Worker finished "${change}" — ${formatUsage(result.usage)}`,
				failed ? "error" : "info",
			);
			// Put the full report in the transcript without triggering a turn.
			pi.sendMessage({
				customType: "opsx-worker-report",
				content: `## Worker report — ${change}\n\n${result.report}\n\n_${formatUsage(result.usage, result.model)}_`,
				display: true,
				details: { ...result },
			});
		},
	});
}

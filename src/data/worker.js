// Research worker dispatch. The worker is a Claude Code Routine with web search.
// The dashboard starts it through the viewer's "Claude Code Remote" connector and
// reads or edits its schedule. When that connector is unavailable, jobs stay queued.

export const SERVER = 'Claude Code Remote';

const MESSAGES = {
  needs_reauth: 'Reconnect Claude Code Remote in claude.ai Settings → Connectors.',
  server_not_connected: 'Add the Claude Code Remote connector in claude.ai Settings → Connectors.',
  selection_required: 'Choose which Claude Code Remote connector to use when claude.ai asks.',
  not_in_manifest: 'The research worker is turned off for this page. Allow Claude Code Remote in the page permissions.',
  blocked_by_policy: 'Your organization blocks the research worker tools.',
  approval_required: 'Your organization requires approval for the research worker tools.',
  server_unavailable: 'The research worker service did not answer. Try again in a minute.',
  tool_error: 'The research worker reported an error.',
  not_granted: 'This view cannot reach connectors.',
  capability_disabled: 'This view cannot reach connectors.',
  capability_removed: 'This view cannot reach connectors.',
  consent_required: 'Allow Claude Code Remote for this page, then try again.',
};

export function describeMcpError(e) {
  const code = e?.code || 'upstream_error';
  return { code, message: MESSAGES[code] ? `${MESSAGES[code]}${code === 'tool_error' && e.message ? ` ${e.message}` : ''}` : e?.message || 'Something went wrong reaching the research worker.', retryable: !!e?.retryable };
}

export function createWorker(mcp) {
  const call = async (tool, input) => {
    if (!mcp) throw { code: 'not_granted', message: 'Connectors unavailable in this view.' };
    const r = await mcp.callTool(SERVER, tool, input, { cache: false });
    return r.payload ?? r;
  };
  return {
    available: !!mcp,
    /** Start the routine for one job. The job id is the only thing passed; the worker reads the job from the database. */
    fire: (triggerId, jobId) => call('fire_trigger', { trigger_id: triggerId, text: `Trendjack job id: ${jobId}` }),
    get: (triggerId) => call('get_trigger', { trigger_id: triggerId }),
    update: (triggerId, patch) => call('update_trigger', { trigger_id: triggerId, ...patch }),
  };
}

export const SCHEDULES = [
  { id: 'off', label: 'Off (manual only)', cron: null },
  { id: 'daily', label: 'Daily, 8:52 am', cron: '52 8 * * *' },
  { id: 'twice', label: 'Mon & Thu, 8:52 am', cron: '52 8 * * 1,4' },
  { id: 'weekly', label: 'Mondays, 8:52 am', cron: '52 8 * * 1' },
];

/** Build a cron expression in the viewer's time zone. */
export function cronFor(scheduleId, tz) {
  const s = SCHEDULES.find((x) => x.id === scheduleId);
  if (!s || !s.cron) return null;
  return tz ? `CRON_TZ=${tz} ${s.cron}` : s.cron;
}

export function scheduleFromCron(cron) {
  if (!cron) return 'off';
  const bare = cron.replace(/^CRON_TZ=\S+\s+/, '');
  return SCHEDULES.find((s) => s.cron === bare)?.id || 'custom';
}

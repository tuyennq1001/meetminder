export const TRANSCRIPT_STATUS_FILTER_OPTIONS = ['completed', 'not_transcribed', 'failed', 'unknown'];

export function getTranscriptStatus(session) {
    return session?.transcript_status || 'unknown';
}

export function transcriptStatusMatches(session, filter) {
    return !filter || getTranscriptStatus(session) === filter;
}

export function renderTranscriptStatusCell(session, t, esc, escAttr) {
    const status = getTranscriptStatus(session);
    const label = t(`logsTable.transcript.${status}`);
    return `<td><span class="transcript-status-badge transcript-status-${escAttr(status)}" title="${escAttr(session.transcript_error || label)}">${esc(label)}</span></td>`;
}

export async function persistTranscriptStatus({ sessions, currentSessionJson, id, status, error, invoke }) {
    const session = sessions.find(item => item.id === id);
    if (session) Object.assign(session, { transcript_status: status, transcript_error: error || null });
    if (currentSessionJson?.id === id) Object.assign(currentSessionJson, { transcript_status: status, transcript_error: error || null });
    try {
        await invoke('update_session_transcript_status', { id, status, error: error || null });
    } catch (err) {
        console.warn('[App] Could not persist transcript status:', err);
    }
}

export function recoverInterruptedTranscriptStatuses(sessions, activeId, t, invoke) {
    for (const session of sessions) {
        if (session.transcript_status !== 'processing' || activeId === session.id) continue;
        session.transcript_status = 'failed';
        session.transcript_error = t('logsTable.transcript.interrupted');
        invoke('update_session_transcript_status', { id: session.id, status: 'failed', error: session.transcript_error })
            .catch(err => console.warn('[App] Could not persist interrupted transcript status:', err));
    }
}

package no.pradhan.agentview.nativeapp.net

import no.pradhan.agentview.nativeapp.codex.meetings.Pending
import no.pradhan.agentview.nativeapp.sessions.state

enum class OfflineState { Hidden, Pending, Shown }
enum class OfflineEvent { Down, Up, Elapsed }

const val OFFLINE_DELAY_MS = 2000L

fun offlineBanner(state: OfflineState, event: OfflineEvent): OfflineState = when (event) {
    OfflineEvent.Up -> OfflineState.Hidden
    OfflineEvent.Down -> if (state == OfflineState.Hidden) OfflineState.Pending else state
    OfflineEvent.Elapsed -> if (state == OfflineState.Pending) OfflineState.Shown else state
}

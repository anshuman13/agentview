package no.pradhan.agentview.nativeapp.app

import kotlinx.coroutines.flow.MutableStateFlow
import no.pradhan.agentview.nativeapp.codex.autopilot.GoalSheet

// Screen flags the shell and the screens share: the bottom bar's visibility and the sheets the shell opens.
class ShellState {
    val navHidden = MutableStateFlow(false)
    val composing = MutableStateFlow(false)
    val addTask = MutableStateFlow(false)
    val goalSheet = MutableStateFlow<GoalSheet?>(null)
}

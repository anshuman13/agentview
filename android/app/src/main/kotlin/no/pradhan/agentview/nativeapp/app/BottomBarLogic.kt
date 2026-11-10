package no.pradhan.agentview.nativeapp.app

data class BarState(val focused: Boolean = false, val dismissed: Boolean = false, val text: Boolean = false)

enum class BarEvent { Focus, Blur, KeyboardUp, KeyboardDown, TextEmpty, TextFilled }

fun barState(state: BarState, event: BarEvent) = when (event) {
    BarEvent.Focus -> state.copy(focused = true, dismissed = false)
    BarEvent.Blur -> state.copy(focused = false, dismissed = false)
    BarEvent.KeyboardUp -> state.copy(dismissed = false)
    BarEvent.KeyboardDown -> state.copy(dismissed = true)
    BarEvent.TextEmpty -> state.copy(text = false)
    BarEvent.TextFilled -> state.copy(text = true)
}

fun barHidden(state: BarState) = state.text || (state.focused && !state.dismissed)

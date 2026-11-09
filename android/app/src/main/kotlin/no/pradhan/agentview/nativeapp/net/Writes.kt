package no.pradhan.agentview.nativeapp.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

const val READ_ONLY_SENT = "Read-only check, nothing was sent"
const val READ_ONLY_OPEN = "Read-only check, saved chats are not opened"

// Every write a page makes to the server: refused with a notice in a read-only run, and a failure shows as a notice.
class Writes(private val scope: CoroutineScope, private val readOnly: () -> Boolean, private val notice: (String) -> Unit) {
    fun allowed(): Boolean {
        if (readOnly()) notice(READ_ONLY_SENT)
        return !readOnly()
    }

    fun run(failure: String, block: suspend () -> Unit, done: (Boolean) -> Unit = {}) {
        if (!allowed()) { done(false); return }
        scope.launch {
            val ok = runCatching { block() }.onFailure { notice(it.message?.ifEmpty { null } ?: failure) }.isSuccess
            done(ok)
        }
    }
}

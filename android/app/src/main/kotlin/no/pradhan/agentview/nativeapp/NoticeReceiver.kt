package no.pradhan.agentview.nativeapp

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import no.pradhan.agentview.nativeapp.app.AppState
import no.pradhan.agentview.nativeapp.app.EXTRA_CHANNEL
import no.pradhan.agentview.nativeapp.app.EXTRA_CHAT
import no.pradhan.agentview.nativeapp.app.EXTRA_NOTICE_ID
import no.pradhan.agentview.nativeapp.app.EXTRA_PERMISSION
import no.pradhan.agentview.nativeapp.app.EXTRA_READONLY
import no.pradhan.agentview.nativeapp.app.KEY_REPLY
import no.pradhan.agentview.nativeapp.app.NoticeKind
import no.pradhan.agentview.nativeapp.app.Notifier
import no.pradhan.agentview.nativeapp.app.runNoticeAction
import no.pradhan.agentview.nativeapp.net.Api
import no.pradhan.agentview.nativeapp.net.DEFAULT_ORIGIN
import no.pradhan.agentview.nativeapp.net.sharedHttp

// Allow, Deny and Reply on a notification; they send the same commands as the buttons in the chat.
class NoticeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val chat = intent.getStringExtra(EXTRA_CHAT) ?: return
        val id = intent.getIntExtra(EXTRA_NOTICE_ID, 0)
        val channel = intent.getStringExtra(EXTRA_CHANNEL) ?: NoticeKind.Approval.channel
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY_REPLY)?.toString().orEmpty()
        val permissionId = intent.getStringExtra(EXTRA_PERMISSION).orEmpty()
        val readOnly = AppState.readOnly || intent.getBooleanExtra(EXTRA_READONLY, false)
        val origin = context.getSharedPreferences("agentview", 0).getString("origin", null) ?: DEFAULT_ORIGIN
        val app = context.applicationContext as Application
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val result = runNoticeAction(Api({ origin }, sharedHttp), readOnly, intent.action.orEmpty(), chat, text, permissionId)
                Notifier(app).settle(id, channel, chat, result)
            } finally {
                pending.finish()
            }
        }
    }
}
